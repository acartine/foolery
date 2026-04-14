import type { OrchestrationPlan } from "@/lib/types";

import {
  type OrchestrationSessionEntry,
  ORCHESTRATION_JSON_TAG,
  pushEvent,
  toObject,
} from "@/lib/orchestration-internals";
import {
  normalizePlan,
  normalizeWave,
} from "@/lib/orchestration-plan-normalization";

export {
  buildPrompt,
  derivePromptScope,
  extractObjectiveBeatIds,
  normalizeAgents,
  normalizePlan,
  normalizeWave,
} from "@/lib/orchestration-plan-normalization";

export function buildDraftPlan(
  entry: OrchestrationSessionEntry,
): OrchestrationPlan {
  const waves = Array.from(entry.draftWaves.values()).sort(
    (a, b) => a.waveIndex - b.waveIndex,
  );

  const assigned = new Set<string>();
  for (const wave of waves) {
    for (const beat of wave.beats) assigned.add(beat.id);
  }

  const unassigned = Array.from(entry.allBeats.keys()).filter(
    (id) => !assigned.has(id),
  );

  return {
    summary: `Drafting ${waves.length} scene${waves.length === 1 ? "" : "s"}...`,
    waves,
    unassignedBeatIds: unassigned,
    assumptions: [],
  };
}

export function extractPlanFromTaggedJson(
  text: string,
  beatTitleMap: Map<string, string>,
): OrchestrationPlan | null {
  const pattern = new RegExp(
    `<${ORCHESTRATION_JSON_TAG}>\\s*([\\s\\S]*?)` +
      `\\s*</${ORCHESTRATION_JSON_TAG}>`,
    "i",
  );
  const match = text.match(pattern);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    return normalizePlan(parsed, beatTitleMap);
  } catch {
    return null;
  }
}

// ── NDJSON line event processing ────────────────────────────────────

export function applyLineEvent(
  entry: OrchestrationSessionEntry,
  line: string,
) {
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
      new Map(
        Array.from(entry.allBeats.values()).map((b) => [
          b.id,
          b.title,
        ]),
      ),
    );
    if (!wave) return;

    entry.draftWaves.set(wave.waveIndex, wave);
    const draftPlan = buildDraftPlan(entry);
    entry.session.plan = draftPlan;
    pushEvent(entry, "plan", draftPlan);
    return;
  }

  if (obj.event === "plan_final") {
    const beatTitleMap = new Map(
      Array.from(entry.allBeats.values()).map((b) => [
        b.id,
        b.title,
      ]),
    );
    const plan = normalizePlan(obj.plan ?? obj, beatTitleMap);
    if (!plan) return;

    entry.session.plan = plan;
    pushEvent(entry, "plan", plan);
  }
}

// ── Logging helpers ─────────────────────────────────────────────────

function formatLogValue(value: unknown): string {
  const raw =
    typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) return "";
  return raw.length > 220
    ? `${raw.slice(0, 220)}...`
    : raw;
}

export function formatStructuredLogLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return `${line}\n`;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const obj = toObject(parsed);
    if (!obj || typeof obj.event !== "string") {
      return `${line}\n`;
    }

    const text =
      typeof obj.text === "string"
        ? obj.text
        : typeof obj.message === "string"
          ? obj.message
          : typeof obj.result === "string"
            ? obj.result
            : "";

    const extras = Object.entries(obj)
      .filter(
        ([key]) =>
          !["event", "text", "message", "result"].includes(
            key,
          ),
      )
      .map(([key, value]) => ({
        key,
        value: formatLogValue(value),
      }))
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

export function consumeAssistantText(
  entry: OrchestrationSessionEntry,
  delta: string,
): string[] {
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

export function summarizeResult(
  result: unknown,
  isError: boolean,
): string {
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
