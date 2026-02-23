import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { getBackend } from "@/lib/backend-instance";
import type { CreateBeadInput, UpdateBeadInput } from "@/lib/backend-port";
import {
  startInteractionLog,
  noopInteractionLog,
  type InteractionLog,
} from "@/lib/interaction-logger";
import { getActionAgent } from "@/lib/settings";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type {
  ApplyOrchestrationOverrides,
  ApplyOrchestrationResult,
  Bead,
  OrchestrationAgentSpec,
  OrchestrationEvent,
  OrchestrationPlan,
  OrchestrationSession,
  OrchestrationWave,
} from "@/lib/types";
import {
  ORCHESTRATION_WAVE_LABEL,
  allocateWaveSlug,
  buildWaveSlugLabel,
  buildWaveTitle,
  extractWaveSlug,
  isLegacyNumericWaveSlug,
} from "@/lib/wave-slugs";

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
  interactionLog: InteractionLog;
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

interface PromptScopeBead {
  id: string;
  title: string;
  type: Bead["type"];
  status: Bead["status"];
  priority: Bead["priority"];
}

function extractObjectiveBeadIds(objective?: string): string[] {
  if (!objective?.trim()) return [];

  const beadIdPattern = /\b[a-z0-9]+-[a-z0-9]+(?:\.[0-9]+)*\b/gi;
  const matches = objective.match(beadIdPattern) ?? [];
  return Array.from(
    new Set(matches.map((match) => match.trim().toLowerCase()))
  );
}

function derivePromptScope(
  beads: Bead[],
  objective?: string
): { scopedBeads: PromptScopeBead[]; unresolvedScopeIds: string[] } {
  const normalizedToOriginal = new Map<string, string>();
  const beadById = new Map<string, Bead>();

  for (const bead of beads) {
    const normalized = bead.id.toLowerCase();
    normalizedToOriginal.set(normalized, bead.id);
    beadById.set(normalized, bead);
  }

  const objectiveIds = extractObjectiveBeadIds(objective);
  const scopedBeads: PromptScopeBead[] = [];
  const unresolvedScopeIds: string[] = [];

  for (const id of objectiveIds) {
    const bead = beadById.get(id);
    if (!bead) {
      unresolvedScopeIds.push(normalizedToOriginal.get(id) ?? id);
      continue;
    }

    scopedBeads.push({
      id: bead.id,
      title: bead.title,
      type: bead.type,
      status: bead.status,
      priority: bead.priority,
    });
  }

  scopedBeads.sort((a, b) => a.id.localeCompare(b.id));
  unresolvedScopeIds.sort((a, b) => a.localeCompare(b));
  return { scopedBeads, unresolvedScopeIds };
}

function buildPrompt(
  repoPath: string,
  scopedBeads: PromptScopeBead[],
  unresolvedScopeIds: string[],
  objective?: string
): string {
  const hasExplicitScope = scopedBeads.length > 0 || unresolvedScopeIds.length > 0;
  return [
    "You are an orchestration planner for engineering work tracked as issues/work items.",
    "Create execution waves that respect dependencies while maximizing useful parallelism.",
    `Repository: ${repoPath}`,
    objective && objective.trim()
      ? `Planning objective: ${objective.trim()}`
      : "Planning objective: Minimize lead time while keeping waves coherent.",
    "",
    "Scope guidance:",
    hasExplicitScope
      ? "Use the explicit work-item IDs below as the in-scope planning set."
      : "No explicit bead IDs were provided. Infer scope from the objective and inspect beads as needed.",
    ...scopedBeads.map(
      (bead) =>
        `- ${bead.id} [${bead.type}, ${bead.status}, P${bead.priority}]: ${bead.title}`
    ),
    ...(unresolvedScopeIds.length > 0
      ? [
          "Objective mentioned IDs not present in open/in_progress/blocked work items:",
          ...unresolvedScopeIds.map((id) => `- ${id}`),
        ]
      : []),
    "",
    "Use your tracker CLI commands to inspect missing context instead of guessing.",
    "",
    "Hard rules:",
    "- Every in-scope bead ID must appear in exactly one wave or in unassigned_bead_ids.",
    "- If blocker -> blocked, blocker must be in an earlier wave than blocked when both are in-scope.",
    "- For each wave, propose agent roles and count. Specialty is optional but useful.",
    "- Keep wave names short and concrete.",
    "- Do not hide execution structure only in notes: emit separate waves whenever possible.",
    "- If planning a single in-scope bead, put it in wave 1 and use later waves with empty bead lists for downstream phases.",
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

function selectKnownInputBeads(
  rawBeadsForWave: Array<{ id: string; title: string }>,
  beadTitleMap: Map<string, string>
): Array<{ id: string; title: string }> {
  return rawBeadsForWave.filter((bead) => beadTitleMap.has(bead.id));
}

function selectFallbackWaveBeads(
  rawBeadsForWave: Array<{ id: string; title: string }>
): Array<{ id: string; title: string }> {
  return rawBeadsForWave;
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
      : `Scene ${waveIndex}`;

  const objective =
    typeof obj.objective === "string" && obj.objective.trim()
      ? obj.objective.trim()
      : "Execute assigned beats for this scene.";

  const notes =
    typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : undefined;

  const agents = normalizeAgents(obj.agents);

  const beadIds = new Set<string>();
  const explicitTitles = new Map<string, string>();

  const rawBeadIds = Array.isArray(obj.bead_ids) ? obj.bead_ids : [];
  for (const value of rawBeadIds) {
    if (typeof value !== "string" || !value.trim()) continue;
    const id = value.trim();
    beadIds.add(id);
  }

  const rawBeads = Array.isArray(obj.beads) ? obj.beads : [];
  for (const value of rawBeads) {
    if (typeof value === "string" && value.trim()) {
      const id = value.trim();
      beadIds.add(id);
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
    if (title) explicitTitles.set(id, title);
  }

  const rawBeadsForWave = Array.from(beadIds).map((id) => ({
    id,
    title: explicitTitles.get(id) ?? beadTitleMap.get(id) ?? id,
  }));

  const knownBeads = selectKnownInputBeads(rawBeadsForWave, beadTitleMap);

  // Preserve the original behavior when known bead IDs are present.
  // Fallback to raw wave beads only when the model emits layout-only IDs.
  const beads =
    knownBeads.length > 0 ? knownBeads : selectFallbackWaveBeads(rawBeadsForWave);

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
      : `Generated ${waves.length} scene${waves.length === 1 ? "" : "s"}.`;

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
    summary: `Drafting ${waves.length} scene${waves.length === 1 ? "" : "s"}...`,
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

function formatLogValue(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) return "";
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
}

function formatStructuredLogLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return `${line}\n`;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const obj = toObject(parsed);
    if (!obj || typeof obj.event !== "string") return `${line}\n`;

    const text =
      typeof obj.text === "string"
        ? obj.text
        : typeof obj.message === "string"
          ? obj.message
          : typeof obj.result === "string"
            ? obj.result
            : "";

    const extras = Object.entries(obj)
      .filter(([key]) => !["event", "text", "message", "result"].includes(key))
      .map(([key, value]) => ({ key, value: formatLogValue(value) }))
      .filter((entry) => entry.value.length > 0);

    const out = [`${obj.event} | ${text || "(no text)"}\n`];
    for (const extra of extras) {
      out.push(`  ${extra.key}: ${extra.value}\n`);
    }
    return out.join("");
  } catch {
    return `${line}\n`;
  }
}

function consumeAssistantText(entry: OrchestrationSessionEntry, delta: string): string[] {
  entry.assistantText += delta;
  entry.lineBuffer += delta;
  const completedLines: string[] = [];

  let newlineIndex = entry.lineBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = entry.lineBuffer.slice(0, newlineIndex);
    entry.lineBuffer = entry.lineBuffer.slice(newlineIndex + 1);
    applyLineEvent(entry, line);
    completedLines.push(line);
    newlineIndex = entry.lineBuffer.indexOf("\n");
  }

  return completedLines;
}

function flushAssistantTail(entry: OrchestrationSessionEntry) {
  if (!entry.lineBuffer.trim()) {
    entry.lineBuffer = "";
    return;
  }

  const tail = entry.lineBuffer;
  entry.lineBuffer = "";
  applyLineEvent(entry, tail);
  pushEvent(entry, "log", formatStructuredLogLine(tail));
}

function summarizeResult(result: unknown, isError: boolean): string {
  if (!isError) return "Claude orchestration complete";
  if (typeof result !== "string" || !result.trim()) {
    return "Claude orchestration failed";
  }

  const firstLine = result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "Claude orchestration failed";
  return firstLine.length > 180
    ? `Claude orchestration failed: ${firstLine.slice(0, 180)}...`
    : `Claude orchestration failed: ${firstLine}`;
}

function finalizeSession(
  entry: OrchestrationSessionEntry,
  status: OrchestrationSession["status"],
  message: string
) {
  if (entry.exited) return;
  entry.exited = true;
  flushAssistantTail(entry);

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

  entry.interactionLog.logEnd(
    status === "completed" ? 0 : 1,
    status,
  );

  entry.session.status = status;
  entry.session.completedAt = new Date().toISOString();
  if (status === "error" || status === "aborted") {
    entry.session.error = message;
    pushEvent(entry, "error", message);
  } else {
    pushEvent(entry, "status", message);
  }

  pushEvent(entry, "exit", message);

  // Free large accumulated strings now that the session is done.
  // Note: allBeads is kept because applyOrchestrationSession uses it
  // after finalization. It is cleared when the session is deleted.
  entry.assistantText = "";
  entry.lineBuffer = "";
  entry.draftWaves.clear();

  // Remove all listeners after a short drain window so SSE clients
  // receive the final exit event before we detach them.
  setTimeout(() => {
    entry.emitter.removeAllListeners();
  }, 2000);

  setTimeout(() => {
    entry.buffer.length = 0;
    entry.allBeads.clear();
    sessions.delete(entry.session.id);
  }, CLEANUP_DELAY_MS);
}

async function collectContext(repoPath: string): Promise<{
  beads: Bead[];
}> {
  const beads = await collectEligibleBeads(repoPath, {
    excludeOrchestrationWaves: true,
  });
  return { beads };
}

async function collectEligibleBeads(
  repoPath: string,
  options?: { excludeOrchestrationWaves?: boolean }
): Promise<Bead[]> {
  const [open, inProgress, blocked] = await Promise.all([
    getBackend().list({ status: "open" }, repoPath),
    getBackend().list({ status: "in_progress" }, repoPath),
    getBackend().list({ status: "blocked" }, repoPath),
  ]);

  for (const result of [open, inProgress, blocked]) {
    if (!result.ok) {
      throw new Error(result.error?.message ?? "Failed to load beads for orchestration");
    }
  }

  const beads = dedupeBeads([
    ...(open.data ?? []),
    ...(inProgress.data ?? []),
    ...(blocked.data ?? []),
  ]);
  if (!options?.excludeOrchestrationWaves) return beads;
  return beads.filter(
    (bead) => !(bead.labels?.includes(ORCHESTRATION_WAVE_LABEL) ?? false)
  );
}

export async function createOrchestrationSession(
  repoPath: string,
  objective?: string
): Promise<OrchestrationSession> {
  const { beads } = await collectContext(repoPath);

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

  const agent = await getActionAgent("direct");

  const orchInteractionLog = await startInteractionLog({
    sessionId: session.id,
    interactionType: "direct",
    repoPath,
    beadIds: beads.map((b) => b.id),
    agentName: agent.label || agent.command,
    agentModel: agent.model,
  }).catch((err) => {
    console.error(`[orchestration-manager] Failed to start interaction log:`, err);
    return noopInteractionLog();
  });

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
    interactionLog: orchInteractionLog,
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  const scope = derivePromptScope(beads, objective);
  const prompt = buildPrompt(
    repoPath,
    scope.scopedBeads,
    scope.unresolvedScopeIds,
    objective
  );
  orchInteractionLog.logPrompt(prompt);
  const scopeSummary =
    scope.scopedBeads.length > 0
      ? scope.scopedBeads.map((bead) => bead.id).join(", ")
      : "inferred from objective";
  const promptLog = [
    "prompt_initial | Orchestration prompt sent",
    `scope | ${scopeSummary}`,
    scope.unresolvedScopeIds.length > 0
      ? `scope_unresolved | ${scope.unresolvedScopeIds.join(", ")}`
      : "",
    objective?.trim() ? `objective | ${objective.trim()}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  pushEvent(entry, "log", promptLog);
  const { command: agentCmd, args } = buildPromptModeArgs(agent, prompt);
  const dialect = resolveDialect(agent.command);
  const normalizeEvent = createLineNormalizer(dialect);
  const child = spawn(agentCmd, args, {
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
      orchInteractionLog.logResponse(line);

      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }

      const obj = toObject(normalizeEvent(raw));
      if (!obj || typeof obj.type !== "string") continue;

      if (obj.type === "stream_event") {
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
        const resultText = summarizeResult(obj.result, isError);

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

  const releaseChildStreams = () => {
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
  };

  child.on("error", (err) => {
    releaseChildStreams();
    const agentLabel = agent.label || agent.command;
    finalizeSession(entry, "error", `Failed to start ${agentLabel}: ${err.message}`);
  });

  child.on("close", (code, signal) => {
    releaseChildStreams();

    if (ndjsonBuffer.trim()) {
      try {
        const raw = JSON.parse(ndjsonBuffer);
        const obj = toObject(normalizeEvent(raw));
        if (obj?.type === "result") {
          const isError = Boolean(obj.is_error);
          const msg = summarizeResult(obj.result, isError);
          finalizeSession(entry, isError ? "error" : "completed", msg);
          return;
        }
      } catch {
        // ignored
      }
    }

    const agentName = agent.label || agent.command;
    const isSuccess = code === 0 && signal == null;
    const message = isSuccess
      ? `${agentName} orchestration complete`
      : `${agentName} exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    finalizeSession(entry, isSuccess ? "completed" : "error", message);
  });

  pushEvent(
    entry,
    "status",
    `Waiting on ${agent.label || agent.command}...`
  );

  return session;
}

export async function createRestagedOrchestrationSession(
  repoPath: string,
  plan: OrchestrationPlan,
  objective?: string
): Promise<OrchestrationSession> {
  const beads = await collectEligibleBeads(repoPath);

  if (beads.length === 0) {
    throw new Error("No open/in_progress/blocked beads available for orchestration");
  }

  const allBeads = new Map(beads.map((bead) => [bead.id, bead]));
  const assigned = new Set<string>();

  const normalizedWaves = plan.waves
    .slice()
    .sort((a, b) => a.waveIndex - b.waveIndex)
    .map((wave, index) => {
      const fallbackWaveIndex = index + 1;
      const waveIndex = Number.isFinite(wave.waveIndex)
        ? Math.max(1, Math.trunc(wave.waveIndex))
        : fallbackWaveIndex;
      const name = wave.name?.trim() || `Scene ${waveIndex}`;
      const waveObjective =
        wave.objective?.trim() || "Execute assigned beats for this scene.";
      const notes = wave.notes?.trim() || undefined;
      const agents = wave.agents
        .filter((agent) => Boolean(agent.role?.trim()))
        .map((agent) => ({
          role: agent.role.trim(),
          count: Math.max(1, Math.trunc(agent.count || 1)),
          specialty: agent.specialty?.trim() || undefined,
        }));

      const beadsForWave = wave.beads
        .filter((bead) => typeof bead.id === "string" && bead.id.trim().length > 0)
        .map((bead) => bead.id.trim())
        .filter((beadId) => allBeads.has(beadId) && !assigned.has(beadId))
        .map((beadId) => {
          assigned.add(beadId);
          return {
            id: beadId,
            title: allBeads.get(beadId)?.title ?? beadId,
          };
        });

      return {
        waveIndex,
        name,
        objective: waveObjective,
        agents,
        beads: beadsForWave,
        notes,
      };
    })
    .filter((wave) => wave.beads.length > 0);

  if (normalizedWaves.length === 0) {
    throw new Error(
      "Restaged plan has no beads currently eligible (open/in_progress/blocked)."
    );
  }

  const normalizedPlan: OrchestrationPlan = {
    summary:
      plan.summary?.trim() ||
      `Restaged ${normalizedWaves.length} scene${
        normalizedWaves.length === 1 ? "" : "s"
      }.`,
    waves: normalizedWaves,
    unassignedBeadIds: (plan.unassignedBeadIds ?? []).filter(
      (id) => typeof id === "string" && allBeads.has(id) && !assigned.has(id)
    ),
    assumptions: (plan.assumptions ?? [])
      .filter((assumption): assumption is string => typeof assumption === "string")
      .map((assumption) => assumption.trim())
      .filter((assumption) => assumption.length > 0),
  };

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
    allBeads,
    draftWaves: new Map(
      normalizedPlan.waves.map((wave) => [wave.waveIndex, wave])
    ),
    assistantText: "",
    lineBuffer: "",
    exited: false,
    interactionLog: noopInteractionLog(),
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  finalizeSession(entry, "completed", "Restaged existing groups into Scene view");
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

function countActiveChildrenByParent(beads: Bead[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bead of beads) {
    if (!bead.parent || bead.status === "closed") continue;
    counts.set(bead.parent, (counts.get(bead.parent) ?? 0) + 1);
  }
  return counts;
}

function isOpenOrchestratedWave(bead: Bead | undefined): boolean {
  if (!bead) return false;
  if (bead.status === "closed") return false;
  return bead.labels?.includes(ORCHESTRATION_WAVE_LABEL) ?? false;
}

function isMissingDependencyError(error?: string): boolean {
  if (!error) return false;
  return /not found|no dependency|does not exist|doesn't exist|no such/i.test(error);
}

export async function applyOrchestrationSession(
  sessionId: string,
  repoPath: string,
  overrides?: ApplyOrchestrationOverrides
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
  const sourceParentIds = new Set<string>();
  const createdWaveIds = new Set<string>();

  let previousWaveId: string | null = null;
  const existing = await getBackend().list(undefined, repoPath);
  if (!existing.ok || !existing.data) {
    throw new Error(existing.error?.message ?? "Failed to load existing scenes");
  }
  const usedWaveSlugs = new Set<string>();
  for (const bead of existing.data) {
    if (!bead.labels?.includes(ORCHESTRATION_WAVE_LABEL)) continue;
    const slug = extractWaveSlug(bead.labels);
    if (!slug || isLegacyNumericWaveSlug(slug)) continue;
    usedWaveSlugs.add(slug);
  }

  for (const wave of plan.waves.slice().sort((a, b) => a.waveIndex - b.waveIndex)) {
    const validChildren = wave.beads.filter((bead) => entry.allBeads.has(bead.id));

    if (validChildren.length === 0) {
      skipped.push(`wave:${wave.waveIndex}`);
      continue;
    }

    let wavePriority: Bead["priority"] = 2;
    let hasPriority = false;
    for (const bead of validChildren) {
      const priority = entry.allBeads.get(bead.id)?.priority;
      if (priority === undefined) continue;
      if (!hasPriority || priority < wavePriority) {
        wavePriority = priority;
        hasPriority = true;
      }
    }

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

    const waveIndexKey = String(wave.waveIndex);
    const overriddenName = overrides?.waveNames?.[waveIndexKey]?.trim();
    const waveName = overriddenName || wave.name;
    const overrideSlug = overrides?.waveSlugs?.[waveIndexKey];
    const waveSlug = allocateWaveSlug(usedWaveSlugs, overrideSlug);
    const waveTitle = buildWaveTitle(waveSlug, waveName);

    const createResult = await getBackend().create(
      {
        title: waveTitle,
        type: "epic",
        priority: wavePriority,
        labels: [ORCHESTRATION_WAVE_LABEL, buildWaveSlugLabel(waveSlug)],
        description,
      } as CreateBeadInput,
      repoPath,
    );

    if (!createResult.ok || !createResult.data?.id) {
      throw new Error(createResult.error?.message ?? `Failed to create scene ${wave.waveIndex}`);
    }

    const waveId = createResult.data.id;
    createdWaveIds.add(waveId);

    for (const child of validChildren) {
      const currentParentId = entry.allBeads.get(child.id)?.parent;
      if (currentParentId) sourceParentIds.add(currentParentId);

      const updateResult = await getBackend().update(
        child.id,
        { parent: waveId } as UpdateBeadInput,
        repoPath,
      );
      if (!updateResult.ok) {
        throw new Error(updateResult.error?.message ?? `Failed to reparent ${child.id}`);
      }

      const refreshed = await getBackend().get(child.id, repoPath);
      if (!refreshed.ok || refreshed.data?.parent !== waveId) {
        throw new Error(`Failed to confirm ${child.id} parent relationship to ${waveId}`);
      }

      const existingChild = entry.allBeads.get(child.id);
      if (existingChild) {
        entry.allBeads.set(child.id, { ...existingChild, parent: waveId });
      }

      // Rewrites move children to a new wave; prune old wave->child edge if present.
      if (currentParentId && currentParentId !== waveId) {
        const removeResult = await getBackend().removeDependency(currentParentId, child.id, repoPath);
        if (!removeResult.ok && !isMissingDependencyError(removeResult.error?.message)) {
          throw new Error(
            removeResult.error?.message ??
              `Failed to remove dependency ${currentParentId} -> ${child.id}`
          );
        }
      }

      const relationDep = await getBackend().addDependency(waveId, child.id, repoPath);
      if (
        !relationDep.ok &&
        !/already exists|duplicate|exists/i.test(relationDep.error?.message ?? "")
      ) {
        throw new Error(
          relationDep.error?.message ?? `Failed to link scene ${waveId} to ${child.id}`
        );
      }
    }

    if (previousWaveId) {
      const depResult = await getBackend().addDependency(previousWaveId, waveId, repoPath);
      if (!depResult.ok) {
        throw new Error(depResult.error?.message ?? `Failed to link scenes ${previousWaveId} -> ${waveId}`);
      }
    }
    previousWaveId = waveId;

    applied.push({
      waveIndex: wave.waveIndex,
      waveId,
      waveSlug,
      waveTitle,
      childCount: validChildren.length,
      children: validChildren.map((child) => ({ id: child.id, title: child.title })),
    });
  }

  if (sourceParentIds.size > 0) {
    const refreshed = await getBackend().list(undefined, repoPath);
    if (!refreshed.ok || !refreshed.data) {
      throw new Error(
        refreshed.error?.message ?? "Failed to refresh beads before closing rewritten source scenes"
      );
    }

    const beadsById = new Map(refreshed.data.map((bead) => [bead.id, bead]));
    const activeChildCounts = countActiveChildrenByParent(refreshed.data);

    for (const parentId of sourceParentIds) {
      if (createdWaveIds.has(parentId)) continue;

      const parent = beadsById.get(parentId);
      if (!isOpenOrchestratedWave(parent)) continue;

      const activeChildren = activeChildCounts.get(parentId) ?? 0;
      if (activeChildren > 0) continue;

      const closeResult = await getBackend().close(
        parentId,
        `Rewritten by orchestration session ${sessionId}`,
        repoPath,
      );
      if (!closeResult.ok) {
        throw new Error(closeResult.error?.message ?? `Failed to close emptied source scene ${parentId}`);
      }
    }
  }

  return {
    applied,
    skipped,
  };
}
