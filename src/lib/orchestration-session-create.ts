import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { getOrchestrationAgent } from "@/lib/settings";
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
import {
  formatAgentDisplayLabel,
} from "@/lib/agent-identity";
import type { OrchestrationSession } from "@/lib/types";
import {
  type OrchestrationSessionEntry,
  sessions,
  generateId,
  toObject,
  buildPrompt,
  collectContext,
  collectExplicitContext,
  pushEvent,
  consumeAssistantText,
  formatStructuredLogLine,
  applyLineEvent,
  extractPlanFromTaggedJson,
  toPromptScopeBeats,
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

  if (obj.type === "text") {
    handleTextEvent(entry, obj);
    return;
  }

  if (obj.type === "item.completed") {
    handleCompletedItemEvent(entry, obj);
    return;
  }

  if (obj.type === "result") {
    handleResultEvent(entry, obj);
  }
}

function appendPlannerText(
  entry: OrchestrationSessionEntry,
  text: string,
) {
  if (!text) return;

  entry.assistantText +=
    (entry.assistantText ? "\n" : "") + text;
  entry.lineBuffer = "";

  for (const line of text.split("\n")) {
    applyLineEvent(entry, line);
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

  appendPlannerText(entry, text);
}

function handleTextEvent(
  entry: OrchestrationSessionEntry,
  obj: Record<string, unknown>,
) {
  const part = toObject(obj.part);
  const text =
    typeof part?.text === "string"
      ? part.text
      : typeof obj.text === "string"
        ? obj.text
        : "";
  appendPlannerText(entry, text);
}

function handleCompletedItemEvent(
  entry: OrchestrationSessionEntry,
  obj: Record<string, unknown>,
) {
  const item = toObject(obj.item);
  const itemType =
    typeof item?.type === "string" ? item.type : "";
  if (
    itemType !== "agent_message" &&
    itemType !== "assistant_message"
  ) {
    return;
  }
  const text =
    typeof item?.text === "string" ? item.text : "";
  appendPlannerText(entry, text);
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
  model?: string,
): Promise<{
  session: OrchestrationSession;
  entry: OrchestrationSessionEntry;
  agent: Awaited<ReturnType<typeof getOrchestrationAgent>>;
}> {
  const session: OrchestrationSession = {
    id: generateId(),
    repoPath,
    status: "running",
    startedAt: new Date().toISOString(),
    objective: objective?.trim() || undefined,
  };

  const agent = await getOrchestrationAgent(model);

  const orchInteractionLog = await startInteractionLog({
    sessionId: session.id,
    interactionType: "direct",
    repoPath,
    beatIds: beats.map((b) => b.id),
    agentName: formatAgentDisplayLabel(agent),
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
  agent: Awaited<ReturnType<typeof getOrchestrationAgent>>,
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
    const agentLabel = formatAgentDisplayLabel(agent);
    finalizeSession(
      entry,
      "error",
      `Failed to start ${agentLabel}: ${err.message}`,
    );
  });

  child.on("close", (code, signal) => {
    releaseChildStreams();
    setImmediate(() => {
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
  });
}

function emitExplicitPromptLog(
  entry: OrchestrationSessionEntry,
  beats: import("@/lib/types").Beat[],
  edges: { blockerId: string; blockedId: string }[],
  repoPath: string,
  objective: string | undefined,
  mode: "scene" | "groom" = "groom",
): string {
  const scopedBeats = toPromptScopeBeats(beats);
  const prompt = buildPrompt(
    repoPath,
    scopedBeats,
    [],
    edges,
    objective,
    mode,
  );
  entry.interactionLog.logPrompt(prompt);
  pushEvent(entry, "log", [
    "prompt_initial | Orchestration prompt sent",
    `scope | ${scopedBeats.map((beat) => beat.id).join(", ")}`,
    objective?.trim()
      ? `objective | ${objective.trim()}`
      : "",
    `mode | ${mode}`,
    edges.length > 0
      ? `edges | ${edges.length}`
      : "",
    "",
  ].filter(Boolean).join("\n"));
  return prompt;
}

export async function createOrchestrationSession(
  repoPath: string,
  objective?: string,
  options?: {
    model?: string;
    mode?: "scene" | "groom";
  },
): Promise<OrchestrationSession> {
  const { beats, edges } = await collectContext(repoPath);

  if (beats.length === 0) {
    throw new Error(
      "No open/in_progress/blocked beats available " +
        "for orchestration",
    );
  }

  const { session, entry, agent } =
    await initSessionEntry(
      repoPath,
      beats,
      objective,
      options?.model,
    );

  const prompt = emitPromptLog(
    entry,
    beats,
    edges,
    repoPath,
    objective,
    options?.mode ?? "groom",
  );

  wireChildProcess(entry, agent, prompt, repoPath);

  pushEvent(
    entry,
    "status",
    `Waiting on ${formatAgentDisplayLabel(agent)}...`,
  );

  return session;
}

export async function createExplicitOrchestrationSession(
  repoPath: string,
  beatIds: string[],
  objective?: string,
  options?: {
    model?: string;
    mode?: "scene" | "groom";
  },
): Promise<OrchestrationSession> {
  const { beats, edges, missingBeatIds } =
    await collectExplicitContext(repoPath, beatIds);

  if (missingBeatIds.length > 0) {
    throw new Error(
      `Missing beats for orchestration: ${missingBeatIds.join(", ")}`,
    );
  }

  if (beats.length === 0) {
    throw new Error(
      "No explicit beats provided for orchestration",
    );
  }

  const { session, entry, agent } = await initSessionEntry(
    repoPath,
    beats,
    objective,
    options?.model,
  );

  const prompt = emitExplicitPromptLog(
    entry,
    beats,
    edges,
    repoPath,
    objective,
    options?.mode ?? "groom",
  );

  wireChildProcess(entry, agent, prompt, repoPath);

  pushEvent(
    entry,
    "status",
    `Waiting on ${formatAgentDisplayLabel(agent)}...`,
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

  const agentName = formatAgentDisplayLabel(agent);
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
