/**
 * Pure normalization/parsing helpers for breakdown plans.
 *
 * Extracted from breakdown-manager.ts to respect the 500-line limit.
 */

import type {
  BeatPriority,
  BeatType,
  BreakdownBeatSpec,
  BreakdownPlan,
  BreakdownWave,
} from "@/lib/types";

type JsonObject = Record<string, unknown>;

const BREAKDOWN_JSON_TAG = "breakdown_plan_json";

export { BREAKDOWN_JSON_TAG };

export function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  return value as JsonObject;
}

function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function normalizeBeatSpec(
  raw: unknown,
): BreakdownBeatSpec | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null;

  const validTypes: BeatType[] = [
    "bug", "feature", "task", "epic", "chore", "merge-request", "gate",
  ];
  const rawType =
    typeof obj.type === "string" ? obj.type.trim().toLowerCase() : "task";
  const type = (
    validTypes.includes(rawType as BeatType) ? rawType : "task"
  ) as BeatType;

  const priority = Math.min(
    4, Math.max(0, toInt(obj.priority, 2)),
  ) as BeatPriority;

  const description =
    typeof obj.description === "string" && obj.description.trim()
      ? obj.description.trim()
      : undefined;

  return { title, type, priority, description };
}

export function normalizeBreakdownWave(
  raw: unknown,
  fallbackIndex: number,
): BreakdownWave | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const waveIndex = toInt(
    obj.wave_index ?? obj.waveIndex ?? obj.index, fallbackIndex,
  );
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name.trim()
      : `Scene ${waveIndex}`;
  const objective =
    typeof obj.objective === "string" && obj.objective.trim()
      ? obj.objective.trim()
      : "Execute assigned tasks for this scene.";
  const notes =
    typeof obj.notes === "string" && obj.notes.trim()
      ? obj.notes.trim()
      : undefined;

  const rawBeats = Array.isArray(obj.beats) ? obj.beats : [];
  const beats = rawBeats
    .map((b) => normalizeBeatSpec(b))
    .filter((b): b is BreakdownBeatSpec => b !== null);

  if (beats.length === 0) return null;

  return { waveIndex, name, objective, beats, notes };
}

export function normalizeBreakdownPlan(
  raw: unknown,
): BreakdownPlan | null {
  const obj = toObject(raw);
  if (!obj) return null;

  const rawWaves = Array.isArray(obj.waves) ? obj.waves : [];
  const waves = rawWaves
    .map((wave, index) => normalizeBreakdownWave(wave, index + 1))
    .filter((wave): wave is BreakdownWave => wave !== null)
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

export function extractPlanFromTaggedJson(
  text: string,
): BreakdownPlan | null {
  const pattern = new RegExp(
    `<${BREAKDOWN_JSON_TAG}>\\s*([\\s\\S]*?)\\s*</${BREAKDOWN_JSON_TAG}>`,
    "i",
  );
  const match = text.match(pattern);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    return normalizeBreakdownPlan(parsed);
  } catch {
    return null;
  }
}
