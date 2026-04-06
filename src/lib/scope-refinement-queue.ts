export interface ScopeRefinementJob {
  id: string;
  beatId: string;
  repoPath?: string;
  excludeAgentIds?: string[];
  createdAt: number;
}

type EnqueueListener = () => void;

interface ScopeRefinementQueueState {
  jobs: ScopeRefinementJob[];
  nextId: number;
}

const g = globalThis as typeof globalThis & {
  __scopeRefinementQueueState?: ScopeRefinementQueueState;
  __scopeRefinementEnqueueListeners?: EnqueueListener[];
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

function getListeners(): EnqueueListener[] {
  if (!g.__scopeRefinementEnqueueListeners) {
    g.__scopeRefinementEnqueueListeners = [];
  }
  return g.__scopeRefinementEnqueueListeners;
}

/**
 * Register a callback invoked each time a job is enqueued.
 * Returns an unsubscribe function.
 */
export function onEnqueue(listener: EnqueueListener): () => void {
  getListeners().push(listener);
  return () => {
    const list = getListeners();
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  };
}

export function enqueueScopeRefinementJob(
  input: Omit<ScopeRefinementJob, "id" | "createdAt">,
): ScopeRefinementJob {
  const state = getQueueState();
  const job: ScopeRefinementJob = {
    id: `scope-refinement-${state.nextId++}`,
    beatId: input.beatId,
    ...(input.repoPath
      ? { repoPath: input.repoPath }
      : {}),
    ...(input.excludeAgentIds?.length
      ? { excludeAgentIds: input.excludeAgentIds }
      : {}),
    createdAt: Date.now(),
  };
  state.jobs.push(job);
  for (const listener of getListeners()) listener();
  return job;
}

export function dequeueScopeRefinementJob(
): ScopeRefinementJob | undefined {
  return getQueueState().jobs.shift();
}

export function peekScopeRefinementJob(
): ScopeRefinementJob | undefined {
  return getQueueState().jobs[0];
}

export function getScopeRefinementQueueSize(): number {
  return getQueueState().jobs.length;
}

export function clearScopeRefinementQueue(): void {
  const state = getQueueState();
  state.jobs = [];
  state.nextId = 1;
  g.__scopeRefinementEnqueueListeners = [];
}
