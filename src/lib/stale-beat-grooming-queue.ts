export interface StaleBeatGroomingJob {
  id: string;
  beatId: string;
  agentId: string;
  createdAt: number;
  repoPath?: string;
}

interface QueueState {
  jobs: StaleBeatGroomingJob[];
  nextId: number;
}

const g = globalThis as typeof globalThis & {
  __staleBeatGroomingQueue?: QueueState;
};

function queueState(): QueueState {
  if (!g.__staleBeatGroomingQueue) {
    g.__staleBeatGroomingQueue = {
      jobs: [],
      nextId: 1,
    };
  }
  return g.__staleBeatGroomingQueue;
}

export function enqueueStaleBeatGroomingJob(
  input: Omit<StaleBeatGroomingJob, "id" | "createdAt">,
): StaleBeatGroomingJob {
  const state = queueState();
  const job: StaleBeatGroomingJob = {
    id: `stale-grooming-${state.nextId++}`,
    beatId: input.beatId,
    agentId: input.agentId,
    createdAt: Date.now(),
    ...(input.repoPath ? { repoPath: input.repoPath } : {}),
  };
  state.jobs.push(job);
  return job;
}

export function dequeueStaleBeatGroomingJob():
  StaleBeatGroomingJob | undefined {
  return queueState().jobs.shift();
}

export function getStaleBeatGroomingQueueSize(): number {
  return queueState().jobs.length;
}

export function clearStaleBeatGroomingQueue(): void {
  g.__staleBeatGroomingQueue = {
    jobs: [],
    nextId: 1,
  };
}
