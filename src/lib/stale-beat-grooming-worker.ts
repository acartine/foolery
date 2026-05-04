import {
  dequeueStaleBeatGroomingJob,
  enqueueStaleBeatGroomingJob,
  getStaleBeatGroomingQueueSize,
} from "@/lib/stale-beat-grooming-queue";
import {
  processStaleBeatGroomingJob,
} from "@/lib/stale-beat-grooming-job-runner";
import {
  recordStaleBeatGroomingQueued,
} from "@/lib/stale-beat-grooming-store";
import type {
  StaleBeatReviewTarget,
} from "@/lib/stale-beat-grooming-types";

const g = globalThis as typeof globalThis & {
  __staleBeatGroomingWorkerRunning?: boolean;
};

export function enqueueStaleBeatGroomingReview(input: {
  target: StaleBeatReviewTarget;
  agentId: string;
  modelOverride?: string;
}): { id: string; beatId: string; repoPath?: string } {
  const job = enqueueStaleBeatGroomingJob({
    beatId: input.target.beatId,
    agentId: input.agentId,
    ...(input.target.repoPath
      ? { repoPath: input.target.repoPath }
      : {}),
    ...(input.modelOverride
      ? { modelOverride: input.modelOverride }
      : {}),
  });
  recordStaleBeatGroomingQueued({
    jobId: job.id,
    beatId: job.beatId,
    agentId: job.agentId,
    ...(job.repoPath ? { repoPath: job.repoPath } : {}),
    ...(job.modelOverride
      ? { modelOverride: job.modelOverride }
      : {}),
  });
  startStaleBeatGroomingWorker();
  return {
    id: job.id,
    beatId: job.beatId,
    ...(job.repoPath ? { repoPath: job.repoPath } : {}),
  };
}

export function startStaleBeatGroomingWorker(): void {
  if (g.__staleBeatGroomingWorkerRunning) return;
  g.__staleBeatGroomingWorkerRunning = true;
  void drainQueue().catch((error) => {
    console.warn(
      `[stale-grooming] worker stopped unexpectedly: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    g.__staleBeatGroomingWorkerRunning = false;
  });
}

async function drainQueue(): Promise<void> {
  while (getStaleBeatGroomingQueueSize() > 0) {
    const job = dequeueStaleBeatGroomingJob();
    if (!job) continue;
    await processStaleBeatGroomingJob(job);
  }
  g.__staleBeatGroomingWorkerRunning = false;
}
