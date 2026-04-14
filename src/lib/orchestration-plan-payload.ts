import type {
  ExecutionPlanRecord,
  KnotRecord,
} from "@/lib/knots";
import type { OrchestrationPlan } from "@/lib/types";
import type {
  CreatePlanInput,
  Plan,
  PlanStatus,
  PlanStep,
  PlanWave,
} from "@/lib/orchestration-plan-types";

const DEFAULT_MODE = "groom";

interface RawPlanStep {
  id?: unknown;
  title?: unknown;
  beat_ids?: unknown;
  beatIds?: unknown;
  status?: unknown;
  depends_on?: unknown;
  dependsOn?: unknown;
  notes?: unknown;
  started_at?: unknown;
  startedAt?: unknown;
  completed_at?: unknown;
  completedAt?: unknown;
  failed_at?: unknown;
  failedAt?: unknown;
  failure_reason?: unknown;
  failureReason?: unknown;
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
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toPlanStatus(value: unknown): PlanStatus {
  return value === "active" ||
    value === "complete" ||
    value === "aborted"
    ? value
    : "draft";
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

function normalizeBeatIds(
  value: unknown,
  fallback: string[] = [],
): string[] {
  const result = toStringArray(value);
  return result.length > 0 ? result : fallback;
}

function normalizeStepStatus(value: unknown): PlanStep["status"] {
  return value === "in_progress" ||
    value === "complete" ||
    value === "failed"
    ? value
    : "pending";
}

function normalizeStep(
  raw: RawPlanStep,
  waveIndex: number,
  stepIndex: number,
  fallbackBeatIds: string[],
  defaultDependsOn: string[],
): PlanStep {
  const beatIds = normalizeBeatIds(
    raw.beat_ids ?? raw.beatIds,
    fallbackBeatIds,
  );
  const idValue =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `wave-${waveIndex}-step-${stepIndex}`;
  const titleValue =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : `Step ${stepIndex}`;

  return {
    id: idValue,
    title: titleValue,
    waveIndex,
    stepIndex,
    beatIds,
    status: normalizeStepStatus(raw.status),
    dependsOn: normalizeBeatIds(
      raw.depends_on ?? raw.dependsOn,
      defaultDependsOn,
    ),
    notes:
      typeof raw.notes === "string" && raw.notes.trim()
        ? raw.notes.trim()
        : undefined,
    startedAt:
      typeof raw.started_at === "string"
        ? raw.started_at
        : typeof raw.startedAt === "string"
          ? raw.startedAt
          : undefined,
    completedAt:
      typeof raw.completed_at === "string"
        ? raw.completed_at
        : typeof raw.completedAt === "string"
          ? raw.completedAt
          : undefined,
    failedAt:
      typeof raw.failed_at === "string"
        ? raw.failed_at
        : typeof raw.failedAt === "string"
          ? raw.failedAt
          : undefined,
    failureReason:
      typeof raw.failure_reason === "string"
        ? raw.failure_reason
        : typeof raw.failureReason === "string"
          ? raw.failureReason
          : undefined,
  };
}

function normalizeWave(
  raw: RawPlanWave,
  fallbackIndex: number,
  previousStepId?: string,
): { wave: PlanWave; lastStepId?: string } {
  const waveIndex = normalizeWaveIndex(
    raw.waveIndex ?? raw.wave_index,
    fallbackIndex,
  );
  const beats = Array.isArray(raw.beats)
    ? raw.beats
        .map((beat) => {
          if (!beat || typeof beat !== "object") return null;
          const obj = beat as Record<string, unknown>;
          const id =
            typeof obj.id === "string" ? obj.id.trim() : "";
          if (!id) return null;
          return {
            id,
            title:
              typeof obj.title === "string" && obj.title.trim()
                ? obj.title.trim()
                : id,
          };
        })
        .filter(
          (
            beat,
          ): beat is { id: string; title: string } =>
            Boolean(beat),
        )
    : [];
  const beatIds = beats.map((beat) => beat.id);

  const rawSteps = Array.isArray(raw.steps)
    ? raw.steps.filter(
        (step): step is RawPlanStep =>
          Boolean(step) && typeof step === "object",
      )
    : [];

  const steps =
    rawSteps.length > 0
      ? rawSteps.map((step, index) => {
          const dependsOn =
            index === 0
              ? previousStepId
                ? [previousStepId]
                : []
              : [];
          return normalizeStep(
            step,
            waveIndex,
            index + 1,
            beatIds,
            dependsOn,
          );
        })
      : [
          normalizeStep(
            {},
            waveIndex,
            1,
            beatIds,
            previousStepId ? [previousStepId] : [],
          ),
        ];

  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index].dependsOn.length === 0) {
      steps[index].dependsOn = [steps[index - 1].id];
    }
  }

  return {
    wave: {
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
      notes:
        typeof raw.notes === "string" && raw.notes.trim()
          ? raw.notes.trim()
          : undefined,
    },
    lastStepId: steps.at(-1)?.id,
  };
}

export function isPlanKnot(record: KnotRecord): boolean {
  return record.type === "execution_plan";
}

export function mapExecutionPlanRecord(
  record: KnotRecord,
): Plan | null {
  const payload = record.execution_plan;
  if (!payload) return null;

  const rawWaves = Array.isArray(payload.waves)
    ? (payload.waves as RawPlanWave[])
    : [];
  const waves: PlanWave[] = [];
  let previousStepId: string | undefined;
  for (const [index, wave] of rawWaves.entries()) {
    const normalized = normalizeWave(
      wave,
      index + 1,
      previousStepId,
    );
    waves.push(normalized.wave);
    previousStepId = normalized.lastStepId;
  }

  return {
    id: record.id,
    repoPath:
      typeof payload.repo_path === "string" &&
      payload.repo_path.trim()
        ? payload.repo_path.trim()
        : "",
    objective:
      typeof payload.objective === "string" &&
      payload.objective.trim()
        ? payload.objective.trim()
        : undefined,
    createdAt: record.created_at ?? record.updated_at,
    updatedAt: record.updated_at,
    status: toPlanStatus(payload.status),
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

export function toExecutionPlanRecord(
  input: CreatePlanInput,
  plan: OrchestrationPlan,
): ExecutionPlanRecord {
  return {
    status: "draft",
    repo_path: input.repoPath,
    objective: input.objective,
    summary: plan.summary,
    waves: plan.waves.map((wave) => {
      const fallbackBeatIds = wave.beats.map((beat) => beat.id);
      const steps =
        wave.steps && wave.steps.length > 0
          ? wave.steps
          : [{ stepIndex: 1, beatIds: fallbackBeatIds }];
      return {
        waveIndex: wave.waveIndex,
        name: wave.name,
        objective: wave.objective,
        agents: wave.agents,
        beats: wave.beats,
        notes: wave.notes,
        steps: steps.map((step, index) => ({
          id:
            `wave-${wave.waveIndex}-step-` +
            `${step.stepIndex ?? index + 1}`,
          title: `Step ${step.stepIndex ?? index + 1}`,
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
  plan: Plan,
): ExecutionPlanRecord {
  return {
    status: plan.status,
    repo_path: plan.repoPath,
    objective: plan.objective,
    summary: plan.summary,
    model: plan.model,
    mode: plan.mode,
    assumptions: plan.assumptions,
    unassigned_beat_ids: plan.unassignedBeatIds,
    waves: plan.waves.map((wave) => ({
      waveIndex: wave.waveIndex,
      name: wave.name,
      objective: wave.objective,
      agents: wave.agents,
      beats: wave.beats,
      notes: wave.notes,
      steps: wave.steps.map((step) => ({
        id: step.id,
        title: step.title,
        beat_ids: step.beatIds,
        status: step.status,
        depends_on: step.dependsOn,
        notes: step.notes,
        started_at: step.startedAt,
        completed_at: step.completedAt,
        failed_at: step.failedAt,
        failure_reason: step.failureReason,
      })),
    })),
  };
}

export function collectPlannedBeatIds(
  payload: ExecutionPlanRecord,
): Set<string> {
  const ids = new Set<string>();
  const waves = Array.isArray(payload.waves)
    ? payload.waves
    : [];
  for (const wave of waves as RawPlanWave[]) {
    if (Array.isArray(wave.beats)) {
      for (const beat of wave.beats) {
        if (!beat || typeof beat !== "object") continue;
        const id = (beat as Record<string, unknown>).id;
        if (typeof id === "string" && id.trim()) {
          ids.add(id.trim());
        }
      }
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
