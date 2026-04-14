import type {
  ExecutionPlanRecord,
  KnotRecord,
} from "@/lib/knots";
import type { OrchestrationPlan } from "@/lib/types";
import type {
  CreatePlanInput,
  PlanArtifact,
  PlanDocument,
  PlanStep,
  PlanSummary,
  PlanWave,
} from "@/lib/orchestration-plan-types";

const DEFAULT_MODE = "groom";

interface RawPlanStep {
  step_index?: unknown;
  stepIndex?: unknown;
  beat_ids?: unknown;
  beatIds?: unknown;
  notes?: unknown;
}

interface RawPlanWave {
  waveIndex?: unknown;
  wave_index?: unknown;
  name?: unknown;
  objective?: unknown;
  agents?: unknown;
  beats?: unknown;
  notes?: unknown;
  steps?: unknown;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeSummary(
  payload: ExecutionPlanRecord,
  objective?: string,
): string {
  const summary =
    typeof payload.summary === "string"
      ? payload.summary.trim()
      : "";
  if (summary) return summary;
  if (objective?.trim()) {
    return `Execution plan for ${objective.trim()}`;
  }
  return "Execution plan";
}

function normalizeMode(
  value: unknown,
): "scene" | "groom" | undefined {
  return value === "scene" || value === "groom"
    ? value
    : undefined;
}

function normalizeWaveIndex(
  value: unknown,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeStepIndex(
  value: unknown,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeBeatIds(
  value: unknown,
  fallback: string[] = [],
): string[] {
  const result = toStringArray(value);
  return result.length > 0 ? result : fallback;
}

function normalizeNotes(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeStep(
  raw: RawPlanStep,
  stepIndex: number,
  fallbackBeatIds: string[],
): PlanStep {
  return {
    stepIndex: normalizeStepIndex(
      raw.step_index ?? raw.stepIndex,
      stepIndex,
    ),
    beatIds: normalizeBeatIds(
      raw.beat_ids ?? raw.beatIds,
      fallbackBeatIds,
    ),
    notes: normalizeNotes(raw.notes),
  };
}

function normalizeBeats(
  value: unknown,
): Array<{ id: string; title: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const beats: Array<{ id: string; title: string }> = [];
  for (const beat of value) {
    if (!beat || typeof beat !== "object") continue;
    const obj = beat as Record<string, unknown>;
    const id =
      typeof obj.id === "string" ? obj.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    beats.push({
      id,
      title:
        typeof obj.title === "string" && obj.title.trim()
          ? obj.title.trim()
          : id,
    });
  }
  return beats;
}

function normalizeWave(
  raw: RawPlanWave,
  fallbackIndex: number,
): PlanWave {
  const waveIndex = normalizeWaveIndex(
    raw.waveIndex ?? raw.wave_index,
    fallbackIndex,
  );
  const beats = normalizeBeats(raw.beats);
  const fallbackBeatIds = beats.map((beat) => beat.id);
  const rawSteps = Array.isArray(raw.steps)
    ? raw.steps.filter(
        (step): step is RawPlanStep =>
          Boolean(step) && typeof step === "object",
      )
    : [];
  const steps =
    rawSteps.length > 0
      ? rawSteps.map((step, index) =>
          normalizeStep(step, index + 1, fallbackBeatIds),
        )
      : [
          normalizeStep(
            {},
            1,
            fallbackBeatIds,
          ),
        ];

  return {
    waveIndex,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : `Wave ${waveIndex}`,
    objective:
      typeof raw.objective === "string" && raw.objective.trim()
        ? raw.objective.trim()
        : "Execute assigned beats.",
    agents: Array.isArray(raw.agents)
      ? (raw.agents as PlanWave["agents"])
      : [],
    beats,
    steps,
    notes: normalizeNotes(raw.notes),
  };
}

function collectBeatIdsFromWaves(
  waves: PlanWave[],
): string[] {
  const ids = new Set<string>();
  for (const wave of waves) {
    for (const beat of wave.beats) {
      ids.add(beat.id);
    }
    for (const step of wave.steps) {
      for (const beatId of step.beatIds) {
        ids.add(beatId);
      }
    }
  }
  return Array.from(ids);
}

export function isPlanKnot(record: KnotRecord): boolean {
  return record.type === "execution_plan";
}

export function mapPlanArtifact(
  record: KnotRecord,
): PlanArtifact | null {
  if (!isPlanKnot(record)) return null;
  return {
    id: record.id,
    type: "execution_plan",
    state: record.state,
    workflowId: record.workflow_id ?? undefined,
    createdAt: record.created_at ?? record.updated_at,
    updatedAt: record.updated_at,
  };
}

export function mapExecutionPlanDocument(
  record: KnotRecord,
): PlanDocument | null {
  const payload = record.execution_plan;
  if (!payload) return null;

  const rawWaves = Array.isArray(payload.waves)
    ? (payload.waves as RawPlanWave[])
    : [];
  const waves = rawWaves.map((wave, index) =>
    normalizeWave(wave, index + 1),
  );
  const beatIds = normalizeBeatIds(
    payload.beat_ids,
    collectBeatIdsFromWaves(waves),
  );

  return {
    repoPath:
      typeof payload.repo_path === "string" &&
      payload.repo_path.trim()
        ? payload.repo_path.trim()
        : "",
    beatIds,
    objective:
      typeof payload.objective === "string" &&
      payload.objective.trim()
        ? payload.objective.trim()
        : undefined,
    summary: normalizeSummary(payload, payload.objective),
    waves,
    unassignedBeatIds: toStringArray(
      payload.unassigned_beat_ids,
    ),
    assumptions: toStringArray(payload.assumptions),
    mode: normalizeMode(payload.mode),
    model:
      typeof payload.model === "string" && payload.model.trim()
        ? payload.model.trim()
        : undefined,
  };
}

export function mapPlanSummary(
  record: KnotRecord,
): PlanSummary | null {
  const artifact = mapPlanArtifact(record);
  const plan = mapExecutionPlanDocument(record);
  if (!artifact || !plan) return null;
  return {
    artifact,
    plan: {
      repoPath: plan.repoPath,
      beatIds: plan.beatIds,
      objective: plan.objective,
      summary: plan.summary,
      mode: plan.mode,
      model: plan.model,
    },
  };
}

export function toExecutionPlanRecord(
  input: CreatePlanInput,
  plan: OrchestrationPlan,
): ExecutionPlanRecord {
  return {
    repo_path: input.repoPath,
    objective: input.objective,
    summary: plan.summary,
    beat_ids: input.beatIds,
    waves: plan.waves.map((wave) => {
      const fallbackBeatIds = wave.beats.map((beat) => beat.id);
      const steps =
        wave.steps && wave.steps.length > 0
          ? wave.steps
          : [{ stepIndex: 1, beatIds: fallbackBeatIds }];
      return {
        wave_index: wave.waveIndex,
        name: wave.name,
        objective: wave.objective,
        agents: wave.agents,
        beats: wave.beats,
        notes: wave.notes,
        steps: steps.map((step, index) => ({
          step_index: step.stepIndex ?? index + 1,
          beat_ids: step.beatIds,
          notes: step.notes,
        })),
      };
    }),
    unassigned_beat_ids: plan.unassignedBeatIds,
    assumptions: plan.assumptions,
    model: input.model,
    mode: input.mode ?? DEFAULT_MODE,
  };
}

export function serializePlanRecord(
  plan: PlanDocument,
): ExecutionPlanRecord {
  return {
    repo_path: plan.repoPath,
    objective: plan.objective,
    summary: plan.summary,
    beat_ids: plan.beatIds,
    model: plan.model,
    mode: plan.mode,
    assumptions: plan.assumptions,
    unassigned_beat_ids: plan.unassignedBeatIds,
    waves: plan.waves.map((wave) => ({
      wave_index: wave.waveIndex,
      name: wave.name,
      objective: wave.objective,
      agents: wave.agents,
      beats: wave.beats,
      notes: wave.notes,
      steps: wave.steps.map((step) => ({
        step_index: step.stepIndex,
        beat_ids: step.beatIds,
        notes: step.notes,
      })),
    })),
  };
}

export function collectPlannedBeatIds(
  payload: ExecutionPlanRecord,
): Set<string> {
  const ids = new Set<string>();
  for (const beatId of toStringArray(payload.beat_ids)) {
    ids.add(beatId);
  }
  const waves = Array.isArray(payload.waves)
    ? payload.waves
    : [];
  for (const wave of waves as RawPlanWave[]) {
    for (const beat of normalizeBeats(wave.beats)) {
      ids.add(beat.id);
    }
    if (!Array.isArray(wave.steps)) continue;
    for (const step of wave.steps as RawPlanStep[]) {
      for (const beatId of normalizeBeatIds(
        step.beat_ids ?? step.beatIds,
      )) {
        ids.add(beatId);
      }
    }
  }
  return ids;
}
