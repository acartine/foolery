export interface ScopeRefinementJob {
  id: string;
  beatId: string;
  repoPath?: string;
  createdAt: number;
}

interface ScopeRefinementQueueState {
  jobs: ScopeRefinementJob[];
  nextId: number;
}

const g = globalThis as typeof globalThis & {
  __scopeRefinementQueueState?: ScopeRefinementQueueState;
};

function getQueueState(): ScopeRefinementQueueState {
  if (!g.__scopeRefinementQueueState) {
    g.__scopeRefinementQueueState = {
      jobs: [],
      nextId: 1,
    };
  }
  return g.__scopeRefinementQueueState;
}

export function enqueueScopeRefinementJob(
  input: Omit<ScopeRefinementJob, "id" | "createdAt">,
): ScopeRefinementJob {
  const state = getQueueState();
  const job: ScopeRefinementJob = {
    id: `scope-refinement-${state.nextId++}`,
    beatId: input.beatId,
    ...(input.repoPath ? { repoPath: input.repoPath } : {}),
    createdAt: Date.now(),
  };
  state.jobs.push(job);
  return job;
}

export function dequeueScopeRefinementJob(): ScopeRefinementJob | undefined {
  return getQueueState().jobs.shift();
}

export function peekScopeRefinementJob(): ScopeRefinementJob | undefined {
  return getQueueState().jobs[0];
}

export function getScopeRefinementQueueSize(): number {
  return getQueueState().jobs.length;
}

export function clearScopeRefinementQueue(): void {
  const state = getQueueState();
  state.jobs = [];
  state.nextId = 1;
}
