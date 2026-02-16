import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { addDep, createBead, showBead, updateBead } from "@/lib/bd";
import { getAgentCommand } from "@/lib/settings";
import type {
  ApplyHydrationResult,
  BeadPriority,
  BeadType,
  HydrationBeadSpec,
  HydrationEvent,
  HydrationPlan,
  HydrationSession,
  HydrationWave,
} from "@/lib/types";
import {
  ORCHESTRATION_WAVE_LABEL,
  allocateWaveSlug,
  buildWaveSlugLabel,
  buildWaveTitle,
  extractWaveSlug,
  isLegacyNumericWaveSlug,
} from "@/lib/wave-slugs";
import { listBeads } from "@/lib/bd";

interface HydrationSessionEntry {
  session: HydrationSession;
  process: ChildProcess | null;
  emitter: EventEmitter;
  buffer: HydrationEvent[];
  draftWaves: Map<number, HydrationWave>;
  assistantText: string;
  lineBuffer: string;
  exited: boolean;
}

type JsonObject = Record<string, unknown>;

const MAX_BUFFER = 5000;
const CLEANUP_DELAY_MS = 10 * 60 * 1000;
const HYDRATION_JSON_TAG = "hydration_plan_json";

const g = globalThis as unknown as {
  __hydrationSessions?: Map<string, HydrationSessionEntry>;
};
if (!g.__hydrationSessions) g.__hydrationSessions = new Map();
const sessions = g.__hydrationSessions;

function generateId(): string {
  return `hydr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function buildHydrationPrompt(
  parentTitle: string,
  parentDescription: string,
  repoPath: string
): string {
  return [
    "You are a task decomposition planner for engineering work tracked as beads.",
    "Break down the following feature/epic into concrete implementation tasks,",
    "grouped into dependency-aware scenes (waves) that maximize useful parallelism.",
    "",
    `Feature title: ${parentTitle}`,
    parentDescription ? `Feature description: ${parentDescription}` : "",
    `Repository: ${repoPath}`,
    "",
    "Hard rules:",
    "- Each task should be a concrete, independently implementable unit of work.",
    "- Group tasks into scenes where tasks within a scene can run in parallel.",
    "- Earlier scenes must complete before later scenes can start.",
    "- For each task, specify: title, type (bug/feature/task/chore), priority (0-4), and a brief description.",
    "- Keep scene names short and concrete.",
    "",
    "Output protocol (strict):",
    "1) Emit NDJSON progress lines while thinking:",
    '   {"event":"thinking","text":"..."}',
    "2) Emit one draft line per scene:",
    '   {"event":"wave_draft","wave":{"wave_index":1,"name":"...","objective":"...","beads":[{"title":"...","type":"task","priority":2,"description":"..."}],"notes":"..."}}',
    "3) Emit one final line:",
    `   {"event":"plan_final","plan":{"summary":"...","waves":[{"wave_index":1,"name":"...","objective":"...","beads":[{"title":"...","type":"task","priority":2,"description":"..."}],"notes":"..."}],"assumptions":["..."]}}`,
    "4) Immediately repeat only the final plan JSON between tags:",
    `<${HYDRATION_JSON_TAG}>`,
    "{...}",
    `</${HYDRATION_JSON_TAG}>`,
    "",
    "Do not wrap output in Markdown code fences.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeBeadSpec(raw: unknown): HydrationBeadSpec | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null;

  const validTypes: BeadType[] = ["bug", "feature", "task", "epic", "chore", "merge-request", "molecule", "gate"];
  const rawType = typeof obj.type === "string" ? obj.type.trim().toLowerCase() : "task";
  const type = (validTypes.includes(rawType as BeadType) ? rawType : "task") as BeadType;

  const priority = Math.min(4, Math.max(0, toInt(obj.priority, 2))) as BeadPriority;

  const description =
    typeof obj.description === "string" && obj.description.trim()
      ? obj.description.trim()
      : undefined;

  return { title, type, priority, description };
}

function normalizeHydrationWave(
  raw: unknown,
  fallbackIndex: number
): HydrationWave | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const waveIndex = toInt(obj.wave_index ?? obj.waveIndex ?? obj.index, fallbackIndex);
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : `Scene ${waveIndex}`;
  const objective =
    typeof obj.objective === "string" && obj.objective.trim()
      ? obj.objective.trim()
      : "Execute assigned tasks for this scene.";
  const notes =
    typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : undefined;

  const rawBeads = Array.isArray(obj.beads) ? obj.beads : [];
  const beads = rawBeads
    .map((b) => normalizeBeadSpec(b))
    .filter((b): b is HydrationBeadSpec => b !== null);

  if (beads.length === 0) return null;

  return { waveIndex, name, objective, beads, notes };
}

function normalizeHydrationPlan(raw: unknown): HydrationPlan | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const rawWaves = Array.isArray(obj.waves) ? obj.waves : [];
  const waves = rawWaves
    .map((wave, index) => normalizeHydrationWave(wave, index + 1))
    .filter((wave): wave is HydrationWave => wave !== null)
    .sort((a, b) => a.waveIndex - b.waveIndex);

  if (waves.length === 0) return null;

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : `Generated ${waves.length} scene${waves.length === 1 ? "" : "s"}.`;

  const assumptions = Array.isArray(obj.assumptions)
    ? obj.assumptions.filter((v): v is string => typeof v === "string")
    : [];

  return { summary, waves, assumptions };
}

function buildDraftPlan(entry: HydrationSessionEntry): HydrationPlan {
  const waves = Array.from(entry.draftWaves.values()).sort(
    (a, b) => a.waveIndex - b.waveIndex
  );

  return {
    summary: `Drafting ${waves.length} scene${waves.length === 1 ? "" : "s"}...`,
    waves,
    assumptions: [],
  };
}

function extractPlanFromTaggedJson(text: string): HydrationPlan | null {
  const pattern = new RegExp(
    `<${HYDRATION_JSON_TAG}>\\s*([\\s\\S]*?)\\s*</${HYDRATION_JSON_TAG}>`,
    "i"
  );
  const match = text.match(pattern);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    return normalizeHydrationPlan(parsed);
  } catch {
    return null;
  }
}

function pushEvent(
  entry: HydrationSessionEntry,
  type: HydrationEvent["type"],
  data: HydrationEvent["data"]
) {
  const evt: HydrationEvent = { type, data, timestamp: Date.now() };
  if (entry.buffer.length >= MAX_BUFFER) entry.buffer.shift();
  entry.buffer.push(evt);
  entry.emitter.emit("data", evt);
}

function applyLineEvent(entry: HydrationSessionEntry, line: string) {
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
    const wave = normalizeHydrationWave(
      obj.wave ?? obj,
      entry.draftWaves.size + 1
    );
    if (!wave) return;

    entry.draftWaves.set(wave.waveIndex, wave);
    const draftPlan = buildDraftPlan(entry);
    entry.session.plan = draftPlan;
    pushEvent(entry, "plan", draftPlan);
    return;
  }

  if (obj.event === "plan_final") {
    const plan = normalizeHydrationPlan(obj.plan ?? obj);
    if (!plan) return;

    entry.session.plan = plan;
    pushEvent(entry, "plan", plan);
  }
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
          : "";

    return `${obj.event} | ${text || "(no text)"}\n`;
  } catch {
    return `${line}\n`;
  }
}

function consumeAssistantText(entry: HydrationSessionEntry, delta: string): string[] {
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

function flushAssistantTail(entry: HydrationSessionEntry) {
  if (!entry.lineBuffer.trim()) {
    entry.lineBuffer = "";
    return;
  }

  const tail = entry.lineBuffer;
  entry.lineBuffer = "";
  applyLineEvent(entry, tail);
  pushEvent(entry, "log", formatStructuredLogLine(tail));
}

function finalizeSession(
  entry: HydrationSessionEntry,
  status: HydrationSession["status"],
  message: string
) {
  if (entry.exited) return;
  entry.exited = true;
  flushAssistantTail(entry);

  if (!entry.session.plan) {
    const fromTags = extractPlanFromTaggedJson(entry.assistantText);
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

export async function createHydrationSession(
  repoPath: string,
  parentBeadId: string,
  parentTitle: string,
  parentDescription: string
): Promise<HydrationSession> {
  const session: HydrationSession = {
    id: generateId(),
    repoPath,
    parentBeadId,
    status: "running",
    startedAt: new Date().toISOString(),
  };

  const entry: HydrationSessionEntry = {
    session,
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    draftWaves: new Map(),
    assistantText: "",
    lineBuffer: "",
    exited: false,
  };
  entry.emitter.setMaxListeners(20);
  sessions.set(session.id, entry);

  const prompt = buildHydrationPrompt(parentTitle, parentDescription, repoPath);
  pushEvent(entry, "log", `Starting hydration for: ${parentTitle}\n`);

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

  const agentCmd = await getAgentCommand();
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
        const resultText = isError
          ? "Hydration failed"
          : "Hydration complete";

        if (!entry.session.plan && typeof obj.result === "string") {
          const fromTags = extractPlanFromTaggedJson(obj.result);
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
    if (text) pushEvent(entry, "log", text);
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
          finalizeSession(entry, isError ? "error" : "completed",
            isError ? "Hydration failed" : "Hydration complete");
          return;
        }
      } catch {
        // ignored
      }
    }

    const isSuccess = code === 0 && signal == null;
    const message = isSuccess
      ? "Hydration complete"
      : `Claude exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    finalizeSession(entry, isSuccess ? "completed" : "error", message);
  });

  pushEvent(entry, "status", "Starting Claude hydration...");
  return session;
}

export function getHydrationSession(
  id: string
): HydrationSessionEntry | undefined {
  return sessions.get(id);
}

export function abortHydrationSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry || !entry.process) return false;

  entry.session.status = "aborted";
  entry.process.kill("SIGTERM");

  setTimeout(() => {
    if (entry.process && !entry.process.killed) {
      entry.process.kill("SIGKILL");
    }
  }, 5000);

  finalizeSession(entry, "aborted", "Hydration aborted");
  return true;
}

export async function applyHydrationPlan(
  sessionId: string,
  repoPath: string
): Promise<ApplyHydrationResult> {
  const entry = sessions.get(sessionId);
  if (!entry) throw new Error("Hydration session not found");
  if (!entry.session.plan) throw new Error("No hydration plan available to apply");

  const plan = entry.session.plan;
  const parentBeadId = entry.session.parentBeadId;
  const createdBeadIds: string[] = [];

  const existing = await listBeads(undefined, repoPath);
  if (!existing.ok || !existing.data) {
    throw new Error(existing.error ?? "Failed to load existing beads");
  }
  const usedWaveSlugs = new Set<string>();
  for (const bead of existing.data) {
    if (!bead.labels?.includes(ORCHESTRATION_WAVE_LABEL)) continue;
    const slug = extractWaveSlug(bead.labels);
    if (slug && !isLegacyNumericWaveSlug(slug)) usedWaveSlugs.add(slug);
  }

  let previousWaveId: string | null = null;

  for (const wave of plan.waves.slice().sort((a, b) => a.waveIndex - b.waveIndex)) {
    if (wave.beads.length === 0) continue;

    const minPriority = Math.min(...wave.beads.map((b) => b.priority)) as BeadPriority;

    const waveSlug = allocateWaveSlug(usedWaveSlugs);
    const waveTitle = buildWaveTitle(waveSlug, wave.name);

    const description = [
      `Objective: ${wave.objective}`,
      wave.notes ? `\nNotes: ${wave.notes}` : null,
      `\nAssigned tasks:`,
      ...wave.beads.map((b) => `- ${b.title}`),
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const waveResult = await createBead(
      {
        title: waveTitle,
        type: "molecule",
        priority: minPriority,
        labels: [ORCHESTRATION_WAVE_LABEL, buildWaveSlugLabel(waveSlug)],
        description,
        parent: parentBeadId,
      },
      repoPath
    );

    if (!waveResult.ok || !waveResult.data?.id) {
      throw new Error(waveResult.error ?? `Failed to create scene ${wave.waveIndex}`);
    }

    const waveId = waveResult.data.id;
    createdBeadIds.push(waveId);

    if (previousWaveId) {
      const depResult = await addDep(previousWaveId, waveId, repoPath);
      if (!depResult.ok) {
        throw new Error(depResult.error ?? `Failed to link scenes ${previousWaveId} -> ${waveId}`);
      }
    }
    previousWaveId = waveId;

    for (const spec of wave.beads) {
      const beadResult = await createBead(
        {
          title: spec.title,
          type: spec.type,
          priority: spec.priority,
          description: spec.description,
          parent: waveId,
        },
        repoPath
      );

      if (!beadResult.ok || !beadResult.data?.id) {
        throw new Error(beadResult.error ?? `Failed to create bead: ${spec.title}`);
      }

      createdBeadIds.push(beadResult.data.id);
    }
  }

  return {
    createdBeadIds,
    waveCount: plan.waves.length,
  };
}
