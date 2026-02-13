import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  addDep,
  createBead,
  listBeads,
  listDeps,
  updateBead,
} from "@/lib/bd";
import type {
  ApplyOrchestrationResult,
  Bead,
  OrchestrationAgentSpec,
  OrchestrationEvent,
  OrchestrationPlan,
  OrchestrationSession,
  OrchestrationWave,
} from "@/lib/types";

interface DepEdge {
  blocker: string;
  blocked: string;
}

interface OrchestrationSessionEntry {
  session: OrchestrationSession;
  process: ChildProcess | null;
  emitter: EventEmitter;
  buffer: OrchestrationEvent[];
  allBeads: Map<string, Bead>;
  draftWaves: Map<number, OrchestrationWave>;
  assistantText: string;
  lineBuffer: string;
  exited: boolean;
}

type JsonObject = Record<string, unknown>;

const MAX_BUFFER = 5000;
const CLEANUP_DELAY_MS = 10 * 60 * 1000;
const ORCHESTRATION_JSON_TAG = "orchestration_plan_json";

const g = globalThis as unknown as {
  __orchestrationSessions?: Map<string, OrchestrationSessionEntry>;
};
if (!g.__orchestrationSessions) g.__orchestrationSessions = new Map();
const sessions = g.__orchestrationSessions;

function generateId(): string {
  return `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  return value as JsonObject;
}

function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function dedupeBeads(items: Bead[]): Bead[] {
  const byId = new Map<string, Bead>();
  for (const bead of items) {
    if (!byId.has(bead.id)) byId.set(bead.id, bead);
  }
  return Array.from(byId.values());
}

function buildPrompt(
  repoPath: string,
  beads: Bead[],
  deps: DepEdge[],
  objective?: string
): string {
  const payload = {
    repo_path: repoPath,
    beads: beads
      .slice()
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id);
      })
      .map((bead) => ({
        id: bead.id,
        title: bead.title,
        type: bead.type,
        status: bead.status,
        priority: bead.priority,
        labels: bead.labels,
        parent: bead.parent ?? null,
      })),
    dependencies: deps
      .slice()
      .sort((a, b) => {
        if (a.blocker !== b.blocker) return a.blocker.localeCompare(b.blocker);
        return a.blocked.localeCompare(b.blocked);
      })
      .map((dep) => ({ blocker: dep.blocker, blocked: dep.blocked })),
  };

  return [
    "You are an orchestration planner for engineering work tracked as beads.",
    "Create execution waves that respect dependencies while maximizing useful parallelism.",
    objective && objective.trim()
      ? `Planning objective: ${objective.trim()}`
      : "Planning objective: Minimize lead time while keeping waves coherent.",
    "",
    "Hard rules:",
    "- Every bead ID must appear in exactly one wave or in unassigned_bead_ids.",
    "- If blocker -> blocked, blocker must be in an earlier wave than blocked.",
    "- For each wave, propose agent roles and count. Specialty is optional but useful.",
    "- Keep wave names short and concrete.",
    "",
    "Output protocol (strict):",
    "1) Emit NDJSON progress lines while thinking:",
    '   {"event":"thinking","text":"..."}',
    "2) Emit one draft line per wave:",
    '   {"event":"wave_draft","wave":{"wave_index":1,"name":"...","objective":"...","bead_ids":["..."],"agents":[{"role":"backend","count":2,"specialty":"api"}],"notes":"..."}}',
    "3) Emit one final line:",
    `   {"event":"plan_final","plan":{"summary":"...","waves":[{"wave_index":1,"name":"...","objective":"...","beads":[{"id":"...","title":"..."}],"agents":[{"role":"...","count":1,"specialty":"..."}],"notes":"..."}],"unassigned_bead_ids":["..."],"assumptions":["..."]}}`,
    "4) Immediately repeat only the final plan JSON between tags:",
    `<${ORCHESTRATION_JSON_TAG}>`,
    "{...}",
    `</${ORCHESTRATION_JSON_TAG}>`,
    "",
    "Do not wrap output in Markdown code fences.",
    "",
    "Planning input JSON:",
    JSON.stringify(payload),
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeAgents(raw: unknown): OrchestrationAgentSpec[] {
  if (!Array.isArray(raw)) return [];

  const normalized: OrchestrationAgentSpec[] = [];
  for (const item of raw) {
    const obj = toObject(item);
    if (!obj) continue;

    const role = typeof obj.role === "string" ? obj.role.trim() : "";
    if (!role) continue;

    const count = toInt(obj.count, 1);
    const specialty =
      typeof obj.specialty === "string" && obj.specialty.trim()
        ? obj.specialty.trim()
        : undefined;

    normalized.push({ role, count, specialty });
  }

  return normalized;
}

function normalizeWave(
  raw: unknown,
  fallbackIndex: number,
  beadTitleMap: Map<string, string>
): OrchestrationWave | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const waveIndex = toInt(
    obj.wave_index ?? obj.waveIndex ?? obj.index,
    fallbackIndex
  );

  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : `Wave ${waveIndex}`;

  const objective =
    typeof obj.objective === "string" && obj.objective.trim()
      ? obj.objective.trim()
      : "Execute assigned beads for this wave.";

  const notes =
    typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : undefined;

  const agents = normalizeAgents(obj.agents);

  const beadIds = new Set<string>();
  const beadList: Array<{ id: string; title?: string }> = [];

  const rawBeadIds = Array.isArray(obj.bead_ids) ? obj.bead_ids : [];
  for (const value of rawBeadIds) {
    if (typeof value !== "string" || !value.trim()) continue;
    const id = value.trim();
    beadIds.add(id);
    beadList.push({ id });
  }

  const rawBeads = Array.isArray(obj.beads) ? obj.beads : [];
  for (const value of rawBeads) {
    if (typeof value === "string" && value.trim()) {
      const id = value.trim();
      beadIds.add(id);
      beadList.push({ id });
      continue;
    }

    const beadObj = toObject(value);
    if (!beadObj || typeof beadObj.id !== "string" || !beadObj.id.trim()) continue;
    const id = beadObj.id.trim();
    const title =
      typeof beadObj.title === "string" && beadObj.title.trim()
        ? beadObj.title.trim()
        : undefined;
    beadIds.add(id);
    beadList.push({ id, title });
  }

  const beads = Array.from(beadIds)
    .filter((id) => beadTitleMap.has(id))
    .map((id) => {
      const explicitTitle = beadList.find((entry) => entry.id === id)?.title;
      return {
        id,
        title: explicitTitle ?? beadTitleMap.get(id) ?? id,
      };
    });

  if (beads.length === 0) return null;

  return {
    waveIndex,
    name,
    objective,
    agents,
    beads,
    notes,
  };
}

function normalizePlan(
  raw: unknown,
  beadTitleMap: Map<string, string>
): OrchestrationPlan | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const rawWaves = Array.isArray(obj.waves) ? obj.waves : [];
  const waves = rawWaves
    .map((wave, index) => normalizeWave(wave, index + 1, beadTitleMap))
    .filter((wave): wave is OrchestrationWave => Boolean(wave))
    .sort((a, b) => a.waveIndex - b.waveIndex);

  if (waves.length === 0) return null;

  const assigned = new Set<string>();
  for (const wave of waves) {
    for (const bead of wave.beads) assigned.add(bead.id);
  }

  const inputIds = Array.from(beadTitleMap.keys());
  const rawUnassigned = Array.isArray(obj.unassigned_bead_ids)
    ? obj.unassigned_bead_ids
    : [];
  const normalizedUnassigned = rawUnassigned
    .filter((value): value is string => typeof value === "string")
    .filter((id) => beadTitleMap.has(id));

  for (const id of inputIds) {
    if (!assigned.has(id)) normalizedUnassigned.push(id);
  }

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : `Generated ${waves.length} wave${waves.length === 1 ? "" : "s"}.`;

  const assumptions = Array.isArray(obj.assumptions)
    ? obj.assumptions.filter((value): value is string => typeof value === "string")
    : [];

  return {
    summary,
    waves,
    unassignedBeadIds: Array.from(new Set(normalizedUnassigned)),
    assumptions,
  };
}

function buildDraftPlan(entry: OrchestrationSessionEntry): OrchestrationPlan {
  const waves = Array.from(entry.draftWaves.values()).sort(
    (a, b) => a.waveIndex - b.waveIndex
  );

  const assigned = new Set<string>();
  for (const wave of waves) {
    for (const bead of wave.beads) assigned.add(bead.id);
  }

  const unassigned = Array.from(entry.allBeads.keys()).filter(
    (id) => !assigned.has(id)
  );

  return {
    summary: `Drafting ${waves.length} wave${waves.length === 1 ? "" : "s"}...`,
    waves,
    unassignedBeadIds: unassigned,
    assumptions: [],
  };
}

function extractPlanFromTaggedJson(
  text: string,
  beadTitleMap: Map<string, string>
): OrchestrationPlan | null {
  const pattern = new RegExp(
    `<${ORCHESTRATION_JSON_TAG}>\\s*([\\s\\S]*?)\\s*</${ORCHESTRATION_JSON_TAG}>`,
    "i"
  );
  const match = text.match(pattern);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    return normalizePlan(parsed, beadTitleMap);
  } catch {
    return null;
  }
}

function pushEvent(
  entry: OrchestrationSessionEntry,
  type: OrchestrationEvent["type"],
  data: OrchestrationEvent["data"]
) {
  const evt: OrchestrationEvent = {
    type,
    data,
    timestamp: Date.now(),
  };

  if (entry.buffer.length >= MAX_BUFFER) entry.buffer.shift();
  entry.buffer.push(evt);
  entry.emitter.emit("data", evt);
}

function applyLineEvent(entry: OrchestrationSessionEntry, line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  const obj = toObject(parsed);
  if (!obj || typeof obj.event !== "string") return;

  if (obj.event === "wave_draft") {
    const wave = normalizeWave(
      obj.wave ?? obj,
      entry.draftWaves.size + 1,
      new Map(Array.from(entry.allBeads.values()).map((b) => [b.id, b.title]))
    );
    if (!wave) return;

    entry.draftWaves.set(wave.waveIndex, wave);
    const draftPlan = buildDraftPlan(entry);
    entry.session.plan = draftPlan;
    pushEvent(entry, "plan", draftPlan);
    return;
  }

  if (obj.event === "plan_final") {
    const beadTitleMap = new Map(
      Array.from(entry.allBeads.values()).map((b) => [b.id, b.title])
    );
    const plan = normalizePlan(obj.plan ?? obj, beadTitleMap);
    if (!plan) return;

    entry.session.plan = plan;
    pushEvent(entry, "plan", plan);
  }
}

function consumeAssistantText(entry: OrchestrationSessionEntry, delta: string) {
  entry.assistantText += delta;
  entry.lineBuffer += delta;

  let newlineIndex = entry.lineBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = entry.lineBuffer.slice(0, newlineIndex);
    entry.lineBuffer = entry.lineBuffer.slice(newlineIndex + 1);
    applyLineEvent(entry, line);
    newlineIndex = entry.lineBuffer.indexOf("\n");
  }
}

function finalizeSession(
  entry: OrchestrationSessionEntry,
  status: OrchestrationSession["status"],
  message: string
) {
  if (entry.exited) return;
  entry.exited = true;

  if (!entry.session.plan) {
    const beadTitleMap = new Map(
      Array.from(entry.allBeads.values()).map((b) => [b.id, b.title])
    );
    const fromTags = extractPlanFromTaggedJson(entry.assistantText, beadTitleMap);
    if (fromTags) {
      entry.session.plan = fromTags;
      pushEvent(entry, "plan", fromTags);
    }
  }

  entry.session.status = status;
  entry.session.completedAt = new Date().toISOString();
  if (status === "error" || status === "aborted") {
    entry.session.error = message;
    pushEvent(entry, "error", message);
  } else {
    pushEvent(entry, "status", message);
  }

  pushEvent(entry, "exit", message);

  setTimeout(() => {
    sessions.delete(entry.session.id);
  }, CLEANUP_DELAY_MS);
}

async function collectContext(repoPath: string): Promise<{
  beads: Bead[];
  deps: DepEdge[];
}> {
  const [open, inProgress, blocked] = await Promise.all([
    listBeads({ status: "open" }, repoPath),
    listBeads({ status: "in_progress" }, repoPath),
    listBeads({ status: "blocked" }, repoPath),
  ]);

  for (const result of [open, inProgress, blocked]) {
    if (!result.ok) {
      throw new Error(result.error ?? "Failed to load beads for orchestration");
    }
  }

  const beads = dedupeBeads([
    ...(open.data ?? []),
    ...(inProgress.data ?? []),
    ...(blocked.data ?? []),
  ]);

  const depResults = await Promise.allSettled(beads.map((bead) => listDeps(bead.id, repoPath)));
  const deps: DepEdge[] = [];

  for (const [index, result] of depResults.entries()) {
    if (result.status !== "fulfilled" || !result.value.ok || !result.value.data) continue;

    const blockedBeadId = beads[index]?.id;
    if (!blockedBeadId) continue;

    for (const dep of result.value.data) {
      if (dep.dependency_type !== "blocks") continue;
      const blockerId = dep.id;
      if (!blockerId) continue;
      deps.push({ blocker: blockerId, blocked: blockedBeadId });
    }
  }

  return { beads, deps };
}

export async function createOrchestrationSession(
  repoPath: string,
  objective?: string
): Promise<OrchestrationSession> {
  const { beads, deps } = await collectContext(repoPath);

  if (beads.length === 0) {
    throw new Error("No open/in_progress/blocked beads available for orchestration");
  }

  const session: OrchestrationSession = {
    id: generateId(),
    repoPath,
    status: "running",
    startedAt: new Date().toISOString(),
    objective: objective?.trim() || undefined,
  };

  const entry: OrchestrationSessionEntry = {
    session,
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    allBeads: new Map(beads.map((bead) => [bead.id, bead])),
    draftWaves: new Map(),
    assistantText: "",
    lineBuffer: "",
    exited: false,
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  const prompt = buildPrompt(repoPath, beads, deps, objective);
  const args = [
    "-p",
    prompt,
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
  ];

  const child = spawn("claude", args, {
    cwd: repoPath,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  entry.process = child;

  let ndjsonBuffer = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    ndjsonBuffer += chunk.toString();
    const lines = ndjsonBuffer.split("\n");
    ndjsonBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const obj = toObject(parsed);
      if (!obj || typeof obj.type !== "string") continue;

      if (obj.type === "stream_event") {
        const event = toObject(obj.event);
        const delta = toObject(event?.delta);
        if (
          event?.type === "content_block_delta" &&
          delta?.type === "text_delta" &&
          typeof delta.text === "string"
        ) {
          pushEvent(entry, "log", delta.text);
          consumeAssistantText(entry, delta.text);
        }
        continue;
      }

      if (obj.type === "assistant") {
        const message = toObject(obj.message);
        const content = Array.isArray(message?.content) ? message?.content : [];
        const text = content
          .map((block) => {
            const blockObj = toObject(block);
            return blockObj?.type === "text" && typeof blockObj.text === "string"
              ? blockObj.text
              : "";
          })
          .join("");

        if (text) {
          entry.assistantText = text;
          if (entry.lineBuffer.trim()) {
            const pending = entry.lineBuffer;
            entry.lineBuffer = "";
            for (const pendingLine of pending.split("\n")) {
              applyLineEvent(entry, pendingLine);
            }
          }
        }
        continue;
      }

      if (obj.type === "result") {
        const isError = Boolean(obj.is_error);
        const resultText =
          typeof obj.result === "string" && obj.result.trim()
            ? obj.result.trim()
            : isError
              ? "Claude orchestration failed"
              : "Claude orchestration complete";

        if (!entry.session.plan && typeof obj.result === "string") {
          const beadTitleMap = new Map(
            Array.from(entry.allBeads.values()).map((bead) => [bead.id, bead.title])
          );
          const fromTags = extractPlanFromTaggedJson(obj.result, beadTitleMap);
          if (fromTags) {
            entry.session.plan = fromTags;
            pushEvent(entry, "plan", fromTags);
          }
        }

        finalizeSession(entry, isError ? "error" : "completed", resultText);
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text) return;
    pushEvent(entry, "log", text);
  });

  child.on("error", (err) => {
    finalizeSession(entry, "error", `Failed to start Claude: ${err.message}`);
  });

  child.on("close", (code, signal) => {
    if (ndjsonBuffer.trim()) {
      try {
        const parsed = JSON.parse(ndjsonBuffer);
        const obj = toObject(parsed);
        if (obj?.type === "result") {
          const isError = Boolean(obj.is_error);
          const msg =
            typeof obj.result === "string" && obj.result.trim()
              ? obj.result.trim()
              : isError
                ? "Claude orchestration failed"
                : "Claude orchestration complete";
          finalizeSession(entry, isError ? "error" : "completed", msg);
          return;
        }
      } catch {
        // ignored
      }
    }

    const isSuccess = code === 0 && signal == null;
    const message = isSuccess
      ? "Claude orchestration complete"
      : `Claude exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    finalizeSession(entry, isSuccess ? "completed" : "error", message);
  });

  pushEvent(entry, "status", "Starting Claude orchestration...");

  return session;
}

export function getOrchestrationSession(
  id: string
): OrchestrationSessionEntry | undefined {
  return sessions.get(id);
}

export function listOrchestrationSessions(): OrchestrationSession[] {
  return Array.from(sessions.values()).map((entry) => entry.session);
}

export function abortOrchestrationSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry || !entry.process) return false;

  entry.session.status = "aborted";
  entry.process.kill("SIGTERM");

  setTimeout(() => {
    if (entry.process && !entry.process.killed) {
      entry.process.kill("SIGKILL");
    }
  }, 5000);

  finalizeSession(entry, "aborted", "Orchestration aborted");
  return true;
}

function formatAgentPlan(agents: OrchestrationAgentSpec[]): string {
  if (agents.length === 0) return "- 1 x generalist";
  return agents
    .map((agent) => {
      const specialty = agent.specialty ? ` (${agent.specialty})` : "";
      return `- ${agent.count} x ${agent.role}${specialty}`;
    })
    .join("\n");
}

export async function applyOrchestrationSession(
  sessionId: string,
  repoPath: string
): Promise<ApplyOrchestrationResult> {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error("Orchestration session not found");
  }

  if (!entry.session.plan) {
    throw new Error("No orchestration plan available to apply");
  }

  const plan = entry.session.plan;
  const applied: ApplyOrchestrationResult["applied"] = [];
  const skipped: string[] = [];

  let previousWaveId: string | null = null;

  for (const wave of plan.waves.slice().sort((a, b) => a.waveIndex - b.waveIndex)) {
    const validChildren = wave.beads.filter((bead) => entry.allBeads.has(bead.id));

    if (validChildren.length === 0) {
      skipped.push(`wave:${wave.waveIndex}`);
      continue;
    }

    const priorities = validChildren
      .map((bead) => entry.allBeads.get(bead.id)?.priority)
      .filter((value): value is Bead["priority"] => value !== undefined);
    const wavePriority =
      priorities.length > 0
        ? priorities.reduce((min, current) =>
            current < min ? current : min
          )
        : 2;

    const description = [
      `Generated by orchestration session ${sessionId}.`,
      "",
      `Objective: ${wave.objective}`,
      "",
      "Agent plan:",
      formatAgentPlan(wave.agents),
      "",
      "Assigned beads:",
      ...validChildren.map((bead) => `- ${bead.id}: ${bead.title}`),
      wave.notes ? "" : null,
      wave.notes ? `Notes: ${wave.notes}` : null,
      plan.assumptions.length > 0 ? "" : null,
      plan.assumptions.length > 0 ? "Assumptions:" : null,
      ...plan.assumptions.map((assumption) => `- ${assumption}`),
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const createResult = await createBead(
      {
        title: `Wave ${wave.waveIndex}: ${wave.name}`,
        type: "epic",
        priority: wavePriority,
        labels: ["orchestration:wave", `orchestration:wave:${wave.waveIndex}`],
        description,
      },
      repoPath
    );

    if (!createResult.ok || !createResult.data?.id) {
      throw new Error(createResult.error ?? `Failed to create wave ${wave.waveIndex}`);
    }

    const waveId = createResult.data.id;

    for (const child of validChildren) {
      const updateResult = await updateBead(
        child.id,
        { parent: waveId },
        repoPath
      );
      if (!updateResult.ok) {
        throw new Error(updateResult.error ?? `Failed to reparent ${child.id}`);
      }
    }

    if (previousWaveId) {
      const depResult = await addDep(previousWaveId, waveId, repoPath);
      if (!depResult.ok) {
        throw new Error(depResult.error ?? `Failed to link waves ${previousWaveId} -> ${waveId}`);
      }
    }
    previousWaveId = waveId;

    applied.push({
      waveIndex: wave.waveIndex,
      waveId,
      waveTitle: `Wave ${wave.waveIndex}: ${wave.name}`,
      childCount: validChildren.length,
    });
  }

  return {
    applied,
    skipped,
  };
}
