import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { getStepAgent } from "@/lib/settings";
import { WorkflowStep } from "@/lib/workflows";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
  type AgentDialect,
} from "@/lib/agent-adapter";
import { logTokenUsageForEvent } from "@/lib/agent-token-usage";
import {
  startInteractionLog,
  noopInteractionLog,
} from "@/lib/interaction-logger";
import { agentDisplayName } from "@/lib/agent-identity";
import type {
  OrchestrationPlan,
  OrchestrationSession,
} from "@/lib/types";
import {
  type OrchestrationSessionEntry,
  sessions,
  generateId,
  toObject,
  collectContext,
  collectEligibleBeats,
  pushEvent,
  consumeAssistantText,
  formatStructuredLogLine,
  applyLineEvent,
  extractPlanFromTaggedJson,
  summarizeResult,
  finalizeSession,
} from "@/lib/orchestration-internals";
import { emitPromptLog } from "@/lib/orchestration-session-prompt";

function handleStdoutChunk(
  entry: OrchestrationSessionEntry,
  chunk: Buffer,
  state: { ndjsonBuffer: string },
  beatIds: string[],
  dialect: AgentDialect,
  normalizeEvent: (raw: unknown) => unknown,
) {
  entry.interactionLog.logStdout(chunk.toString());
  state.ndjsonBuffer += chunk.toString();
  const lines = state.ndjsonBuffer.split("\n");
  state.ndjsonBuffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    entry.interactionLog.logResponse(line);

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    logTokenUsageForEvent(
      entry.interactionLog,
      dialect,
      raw,
      beatIds,
    );

    const obj = toObject(normalizeEvent(raw));
    if (!obj || typeof obj.type !== "string") continue;

    handleParsedStdoutEvent(entry, obj);
  }
}

function handleParsedStdoutEvent(
  entry: OrchestrationSessionEntry,
  obj: Record<string, unknown>,
) {
  if (obj.type === "stream_event") {
    handleStreamEvent(entry, obj);
    return;
  }

  if (obj.type === "assistant") {
    handleAssistantEvent(entry, obj);
    return;
  }

  if (obj.type === "result") {
    handleResultEvent(entry, obj);
  }
}

function handleStreamEvent(
  entry: OrchestrationSessionEntry,
  obj: Record<string, unknown>,
) {
  const event = toObject(obj.event);
  const delta = toObject(event?.delta);
  if (
    event?.type === "content_block_delta" &&
    delta?.type === "text_delta" &&
    typeof delta.text === "string"
  ) {
    const completedLines = consumeAssistantText(entry, delta.text);
    for (const completedLine of completedLines) {
      pushEvent(entry, "log", formatStructuredLogLine(completedLine));
    }
  }
}

function handleAssistantEvent(
  entry: OrchestrationSessionEntry,
  obj: Record<string, unknown>,
) {
  const message = toObject(obj.message);
  const content = Array.isArray(message?.content)
    ? message?.content
    : [];
  const text = content
    .map((block) => {
      const blockObj = toObject(block);
      return blockObj?.type === "text" && typeof blockObj.text === "string"
        ? blockObj.text
        : "";
    })
    .join("");

  if (text) {
    // Accumulate rather than replace -- crucial for Codex where
    // multiple agent_message events deliver distinct content.
    entry.assistantText +=
      (entry.assistantText ? "\n" : "") + text;

    // Stale partial line from prior stream_event deltas is superseded.
    entry.lineBuffer = "";

    // Parse the full text line-by-line for NDJSON plan events.
    for (const line of text.split("\n")) {
      applyLineEvent(entry, line);
    }
  }
}

function handleResultEvent(
  entry: OrchestrationSessionEntry,
  obj: Record<string, unknown>,
) {
  const isError = Boolean(obj.is_error);
  const resultText = summarizeResult(obj.result, isError);

  if (!entry.session.plan && typeof obj.result === "string") {
    const beatTitleMap = new Map(
      Array.from(entry.allBeats.values()).map((beat) => [
        beat.id,
        beat.title,
      ])
    );
    const fromTags = extractPlanFromTaggedJson(
      obj.result,
      beatTitleMap
    );
    if (fromTags) {
      entry.session.plan = fromTags;
      pushEvent(entry, "plan", fromTags);
    }
  }

  finalizeSession(
    entry,
    isError ? "error" : "completed",
    resultText
  );
}

async function initSessionEntry(
  repoPath: string,
  beats: import("@/lib/types").Beat[],
  objective?: string,
): Promise<{
  session: OrchestrationSession;
  entry: OrchestrationSessionEntry;
  agent: Awaited<ReturnType<typeof getStepAgent>>;
}> {
  const session: OrchestrationSession = {
    id: generateId(),
    repoPath,
    status: "running",
    startedAt: new Date().toISOString(),
    objective: objective?.trim() || undefined,
  };

  const agent = await getStepAgent(
    WorkflowStep.Planning,
    "scene",
  );

  const orchInteractionLog = await startInteractionLog({
    sessionId: session.id,
    interactionType: "direct",
    repoPath,
    beatIds: beats.map((b) => b.id),
    agentName: agentDisplayName(agent),
    agentModel: agent.model,
    agentVersion: agent.version,
  }).catch((err) => {
    console.error(
      `[orchestration-manager] Failed to start interaction log:`,
      err,
    );
    return noopInteractionLog();
  });

  const entry: OrchestrationSessionEntry = {
    session,
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    allBeats: new Map(
      beats.map((beat) => [beat.id, beat]),
    ),
    draftWaves: new Map(),
    assistantText: "",
    lineBuffer: "",
    exited: false,
    interactionLog: orchInteractionLog,
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  return { session, entry, agent };
}

function wireChildProcess(
  entry: OrchestrationSessionEntry,
  agent: Awaited<ReturnType<typeof getStepAgent>>,
  prompt: string,
  repoPath: string,
) {
  const { command: agentCmd, args } = buildPromptModeArgs(
    agent,
    prompt,
  );
  const dialect = resolveDialect(agent.command ?? "claude");
  const normalizeEvent = createLineNormalizer(dialect);
  const child = spawn(agentCmd, args, {
    cwd: repoPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  entry.process = child;

  const ndjsonState = { ndjsonBuffer: "" };

  child.stdout?.on("data", (chunk: Buffer) => {
    handleStdoutChunk(
      entry,
      chunk,
      ndjsonState,
      Array.from(entry.allBeats.keys()),
      dialect,
      normalizeEvent,
    );
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text) return;
    entry.interactionLog.logStderr(text);
    pushEvent(entry, "log", text);
  });

  const releaseChildStreams = () => {
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
  };

  child.on("error", (err) => {
    releaseChildStreams();
    const agentLabel = agentDisplayName(agent);
    finalizeSession(
      entry,
      "error",
      `Failed to start ${agentLabel}: ${err.message}`,
    );
  });

  child.on("close", (code, signal) => {
    releaseChildStreams();
    handleCloseEvent(
      entry,
      ndjsonState,
      dialect,
      normalizeEvent,
      agent,
      code,
      signal,
    );
  });
}

export async function createOrchestrationSession(
  repoPath: string,
  objective?: string,
): Promise<OrchestrationSession> {
  const { beats } = await collectContext(repoPath);

  if (beats.length === 0) {
    throw new Error(
      "No open/in_progress/blocked beats available " +
        "for orchestration",
    );
  }

  const { session, entry, agent } =
    await initSessionEntry(repoPath, beats, objective);

  const prompt = emitPromptLog(
    entry,
    beats,
    repoPath,
    objective,
  );

  wireChildProcess(entry, agent, prompt, repoPath);

  pushEvent(
    entry,
    "status",
    `Waiting on ${agentDisplayName(agent)}...`,
  );

  return session;
}

function handleCloseEvent(
  entry: OrchestrationSessionEntry,
  ndjsonState: { ndjsonBuffer: string },
  dialect: AgentDialect,
  normalizeEvent: (raw: unknown) => unknown,
  agent: { command?: string },
  code: number | null,
  signal: string | null,
) {
  if (ndjsonState.ndjsonBuffer.trim()) {
    try {
      const raw = JSON.parse(ndjsonState.ndjsonBuffer);
      logTokenUsageForEvent(
        entry.interactionLog,
        dialect,
        raw,
        Array.from(entry.allBeats.keys()),
      );
      const obj = toObject(normalizeEvent(raw));
      if (obj?.type === "result") {
        const isError = Boolean(obj.is_error);
        const msg = summarizeResult(obj.result, isError);
        finalizeSession(
          entry,
          isError ? "error" : "completed",
          msg
        );
        return;
      }
    } catch {
      // ignored
    }
  }

  const agentName = agentDisplayName(agent);
  const isSuccess = code === 0 && signal == null;
  const message = isSuccess
    ? `${agentName} orchestration complete`
    : `${agentName} exited ` +
      `(code=${code ?? "null"}, signal=${signal ?? "null"})`;
  finalizeSession(
    entry,
    isSuccess ? "completed" : "error",
    message
  );
}

function normalizeRestagePlan(
  plan: OrchestrationPlan,
  allBeats: Map<string, import("@/lib/types").Beat>,
): OrchestrationPlan {
  const assigned = new Set<string>();

  const normalizedWaves = plan.waves
    .slice()
    .sort((a, b) => a.waveIndex - b.waveIndex)
    .map((wave, index) => {
      const fallbackWaveIndex = index + 1;
      const waveIndex = Number.isFinite(wave.waveIndex)
        ? Math.max(1, Math.trunc(wave.waveIndex))
        : fallbackWaveIndex;
      const name =
        wave.name?.trim() || `Scene ${waveIndex}`;
      const waveObjective =
        wave.objective?.trim() ||
        "Execute assigned beats for this scene.";
      const notes = wave.notes?.trim() || undefined;
      const agents = wave.agents
        .filter((a) => Boolean(a.role?.trim()))
        .map((a) => ({
          role: a.role.trim(),
          count: Math.max(1, Math.trunc(a.count || 1)),
          specialty: a.specialty?.trim() || undefined,
        }));

      const beatsForWave = wave.beats
        .filter(
          (beat) =>
            typeof beat.id === "string" &&
            beat.id.trim().length > 0,
        )
        .map((beat) => beat.id.trim())
        .filter(
          (beatId) =>
            allBeats.has(beatId) && !assigned.has(beatId),
        )
        .map((beatId) => {
          assigned.add(beatId);
          return {
            id: beatId,
            title:
              allBeats.get(beatId)?.title ?? beatId,
          };
        });

      return {
        waveIndex,
        name,
        objective: waveObjective,
        agents,
        beats: beatsForWave,
        notes,
      };
    })
    .filter((wave) => wave.beats.length > 0);

  if (normalizedWaves.length === 0) {
    throw new Error(
      "Restaged plan has no beats currently eligible " +
        "(open/in_progress/blocked).",
    );
  }

  return {
    summary:
      plan.summary?.trim() ||
      `Restaged ${normalizedWaves.length} scene${
        normalizedWaves.length === 1 ? "" : "s"
      }.`,
    waves: normalizedWaves,
    unassignedBeatIds: (
      plan.unassignedBeatIds ?? []
    ).filter(
      (id) =>
        typeof id === "string" &&
        allBeats.has(id) &&
        !assigned.has(id),
    ),
    assumptions: (plan.assumptions ?? [])
      .filter(
        (assumption): assumption is string =>
          typeof assumption === "string",
      )
      .map((assumption) => assumption.trim())
      .filter((assumption) => assumption.length > 0),
  };
}

// ── createRestagedOrchestrationSession ──────────────────────────────

export async function createRestagedOrchestrationSession(
  repoPath: string,
  plan: OrchestrationPlan,
  objective?: string,
): Promise<OrchestrationSession> {
  const beats = await collectEligibleBeats(repoPath);

  if (beats.length === 0) {
    throw new Error(
      "No open/in_progress/blocked beats available " +
        "for orchestration",
    );
  }

  const allBeats = new Map(
    beats.map((beat) => [beat.id, beat]),
  );
  const normalizedPlan = normalizeRestagePlan(
    plan,
    allBeats,
  );

  const session: OrchestrationSession = {
    id: generateId(),
    repoPath,
    status: "running",
    startedAt: new Date().toISOString(),
    objective: objective?.trim() || undefined,
    plan: normalizedPlan,
  };

  const entry: OrchestrationSessionEntry = {
    session,
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    allBeats,
    draftWaves: new Map(
      normalizedPlan.waves.map((wave) => [
        wave.waveIndex,
        wave,
      ]),
    ),
    assistantText: "",
    lineBuffer: "",
    exited: false,
    interactionLog: noopInteractionLog(),
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  finalizeSession(
    entry,
    "completed",
    "Restaged existing groups into Scene view",
  );
  return session;
}
