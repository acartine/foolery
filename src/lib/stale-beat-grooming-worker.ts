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
import {
  getStaleBeatGroomingWorkerHealth,
  recordStaleBeatGroomingPickup,
  recordStaleBeatGroomingRelease,
  recordStaleBeatGroomingWorkerCompleted,
  recordStaleBeatGroomingWorkerFailed,
  recordStaleBeatGroomingWorkerStarted,
  recordStaleBeatGroomingWorkerStopped,
} from "@/lib/stale-beat-grooming-worker-state";
import type {
  StaleBeatReviewTarget,
} from "@/lib/stale-beat-grooming-types";

export {
  getStaleBeatGroomingWorkerHealth,
};

const g = globalThis as typeof globalThis & {
  __staleBeatGroomingWorkerRunning?: boolean;
};

export function enqueueStaleBeatGroomingReview(input: {
  target: StaleBeatReviewTarget;
  agentId: string;
}): { id: string; beatId: string; repoPath?: string } {
  const job = enqueueStaleBeatGroomingJob({
    beatId: input.target.beatId,
    agentId: input.agentId,
    ...(input.target.repoPath
      ? { repoPath: input.target.repoPath }
      : {}),
  });
  recordStaleBeatGroomingQueued({
    jobId: job.id,
    beatId: job.beatId,
    agentId: job.agentId,
    ...(job.repoPath ? { repoPath: job.repoPath } : {}),
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
  recordStaleBeatGroomingWorkerStarted();
  void drainQueue().catch((error) => {
    console.warn(
      `[stale-grooming] worker stopped unexpectedly: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    g.__staleBeatGroomingWorkerRunning = false;
    recordStaleBeatGroomingWorkerStopped();
  });
}

async function drainQueue(): Promise<void> {
  while (getStaleBeatGroomingQueueSize() > 0) {
    const job = dequeueStaleBeatGroomingJob();
    if (!job) continue;
    recordStaleBeatGroomingPickup(0, job);
    const outcome = await processStaleBeatGroomingJob(job);
    recordStaleBeatGroomingRelease(0);
    if (outcome.ok) {
      recordStaleBeatGroomingWorkerCompleted({
        job,
        result: outcome.result,
      });
    } else {
      recordStaleBeatGroomingWorkerFailed({
        job,
        reason: outcome.error ?? "unknown failure",
      });
    }
  }
  g.__staleBeatGroomingWorkerRunning = false;
  recordStaleBeatGroomingWorkerStopped();
}
