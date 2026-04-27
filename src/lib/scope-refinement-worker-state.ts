import type { ScopeRefinementFailure } from "@/lib/types";

export const MAX_RECENT_FAILURES = 20;

export interface WorkerState {
  workers: Promise<void>[];
  stopping: boolean;
  workerStartedAt: number | null;
  activeJobs: Map<
    number,
    { beatId: string; startedAt: number }
  >;
  totalCompleted: number;
  totalFailed: number;
  recentFailures: ScopeRefinementFailure[];
  retryCounts: Map<string, number>;
}

const g = globalThis as typeof globalThis & {
  __scopeRefinementWorkerState?: WorkerState;
};

export function getWorkerState(): WorkerState {
  if (!g.__scopeRefinementWorkerState) {
    g.__scopeRefinementWorkerState = {
      workers: [],
      stopping: false,
      workerStartedAt: null,
      activeJobs: new Map(),
      totalCompleted: 0,
      totalFailed: 0,
      recentFailures: [],
      retryCounts: new Map(),
    };
  }
  return g.__scopeRefinementWorkerState;
}

export function tag(jobId: string, beatId: string): string {
  return `[scope-refinement][${jobId}] beat=${beatId}`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m${Math.floor(secs % 60)}s`;
}
