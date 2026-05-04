import type {
  StaleBeatGroomingCompletion,
  StaleBeatGroomingFailure,
  StaleBeatGroomingWorkerHealth,
} from "@/lib/stale-beat-grooming-types";
import type {
  StaleBeatGroomingJob,
} from "@/lib/stale-beat-grooming-queue";
import type {
  StaleBeatGroomingResult,
} from "@/lib/stale-beat-grooming-types";

const MAX_RECENT_EVENTS = 20;

interface StaleBeatGroomingWorkerState {
  running: boolean;
  workerStartedAt: number | null;
  activeJobs: Map<number, StaleBeatGroomingJob & { startedAt: number }>;
  totalCompleted: number;
  totalFailed: number;
  recentFailures: StaleBeatGroomingFailure[];
  recentCompletions: StaleBeatGroomingCompletion[];
}

const g = globalThis as typeof globalThis & {
  __staleBeatGroomingWorkerState?: StaleBeatGroomingWorkerState;
};

function workerState(): StaleBeatGroomingWorkerState {
  if (!g.__staleBeatGroomingWorkerState) {
    g.__staleBeatGroomingWorkerState = {
      running: false,
      workerStartedAt: null,
      activeJobs: new Map(),
      totalCompleted: 0,
      totalFailed: 0,
      recentFailures: [],
      recentCompletions: [],
    };
  }
  return g.__staleBeatGroomingWorkerState;
}

export function recordStaleBeatGroomingWorkerStarted(): void {
  const state = workerState();
  state.running = true;
  state.workerStartedAt ??= Date.now();
}

export function recordStaleBeatGroomingWorkerStopped(): void {
  workerState().running = false;
}

export function recordStaleBeatGroomingPickup(
  workerIndex: number,
  job: StaleBeatGroomingJob,
): void {
  workerState().activeJobs.set(workerIndex, {
    ...job,
    startedAt: Date.now(),
  });
}

export function recordStaleBeatGroomingRelease(
  workerIndex: number,
): void {
  workerState().activeJobs.delete(workerIndex);
}

export function recordStaleBeatGroomingWorkerCompleted(input: {
  job: StaleBeatGroomingJob;
  result?: StaleBeatGroomingResult;
}): void {
  const state = workerState();
  state.totalCompleted += 1;
  state.recentCompletions.unshift({
    jobId: input.job.id,
    beatId: input.job.beatId,
    timestamp: Date.now(),
    ...(input.job.repoPath ? { repoPath: input.job.repoPath } : {}),
    ...(input.result?.decision
      ? { decision: input.result.decision }
      : {}),
  });
  state.recentCompletions = state.recentCompletions.slice(
    0,
    MAX_RECENT_EVENTS,
  );
}

export function recordStaleBeatGroomingWorkerFailed(input: {
  job: StaleBeatGroomingJob;
  reason: string;
}): void {
  const state = workerState();
  state.totalFailed += 1;
  state.recentFailures.unshift({
    jobId: input.job.id,
    beatId: input.job.beatId,
    reason: input.reason,
    timestamp: Date.now(),
    ...(input.job.repoPath ? { repoPath: input.job.repoPath } : {}),
  });
  state.recentFailures = state.recentFailures.slice(
    0,
    MAX_RECENT_EVENTS,
  );
}

export function getStaleBeatGroomingWorkerHealth():
  StaleBeatGroomingWorkerHealth {
  const state = workerState();
  return {
    workerCount: state.running ? 1 : 0,
    activeJobs: Array.from(state.activeJobs.values()).map((job) => ({
      jobId: job.id,
      beatId: job.beatId,
      agentId: job.agentId,
      startedAt: job.startedAt,
      ...(job.repoPath ? { repoPath: job.repoPath } : {}),
    })),
    totalCompleted: state.totalCompleted,
    totalFailed: state.totalFailed,
    recentFailures: [...state.recentFailures],
    recentCompletions: [...state.recentCompletions],
    uptimeMs: state.workerStartedAt
      ? Date.now() - state.workerStartedAt
      : null,
  };
}

export function resetStaleBeatGroomingWorkerState(): void {
  g.__staleBeatGroomingWorkerState = undefined;
}
