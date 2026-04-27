import {
  getScopeRefinementAgent,
} from "@/lib/settings";
import {
  dequeueScopeRefinementJob,
  enqueueScopeRefinementJob,
  getScopeRefinementQueueSize,
  onEnqueue,
  type ScopeRefinementJob,
} from "@/lib/scope-refinement-queue";
import {
  fmtMs,
  getWorkerState,
} from "@/lib/scope-refinement-worker-state";
import { processScopeRefinementJob } from "@/lib/scope-refinement-job-runner";
import type {
  ScopeRefinementWorkerHealth,
} from "@/lib/types";

export { processScopeRefinementJob };

const MAX_WORKERS = 2;
const HEARTBEAT_INTERVAL_MS = 30_000;

// ── WorkNotifier (counting semaphore) ─────────────────────

class WorkNotifier {
  private waiters: Array<() => void> = [];
  private pendingCount = 0;

  signal(): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter();
    } else {
      this.pendingCount++;
    }
  }

  async wait(): Promise<void> {
    if (this.pendingCount > 0) {
      this.pendingCount--;
      return;
    }
    return new Promise<void>((r) => {
      this.waiters.push(r);
    });
  }

  cancelAll(): void {
    this.pendingCount = 0;
    for (const waiter of this.waiters) waiter();
    this.waiters = [];
  }
}

const g = globalThis as typeof globalThis & {
  __scopeRefinementNotifier?: WorkNotifier;
  __scopeRefinementWatchdog?: ReturnType<typeof setInterval>;
};

function getNotifier(): WorkNotifier {
  if (!g.__scopeRefinementNotifier) {
    g.__scopeRefinementNotifier = new WorkNotifier();
  }
  return g.__scopeRefinementNotifier;
}

// ── Worker loop ───────────────────────────────────────────

async function runOneJob(
  index: number,
  job: ScopeRefinementJob,
): Promise<void> {
  const pickedUpAt = Date.now();
  const state = getWorkerState();
  state.activeJobs.set(index, {
    beatId: job.beatId,
    startedAt: pickedUpAt,
  });
  console.log(
    `[scope-refinement] worker=${index} pickup `
      + `job=${job.id} beat=${job.beatId} `
      + `queue_age=${fmtMs(pickedUpAt - job.createdAt)} `
      + `queue_remaining=${getScopeRefinementQueueSize()}`,
  );
  try {
    await processScopeRefinementJob(job);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);
    console.warn(
      `[scope-refinement] worker=${index} `
        + `unexpected error job=${job.id} `
        + `beat=${job.beatId}: ${message}`,
    );
  } finally {
    const elapsed = Date.now() - pickedUpAt;
    state.activeJobs.delete(index);
    console.log(
      `[scope-refinement] worker=${index} release `
        + `job=${job.id} beat=${job.beatId} `
        + `elapsed=${fmtMs(elapsed)}`,
    );
  }
}

async function workerLoop(
  index: number,
  notifier: WorkNotifier,
): Promise<void> {
  const state = getWorkerState();
  while (!state.stopping) {
    await notifier.wait();
    if (state.stopping) break;
    const job = dequeueScopeRefinementJob();
    if (!job) continue;
    await runOneJob(index, job);
  }
}

// ── Watchdog ──────────────────────────────────────────────

function startWatchdog(): void {
  if (g.__scopeRefinementWatchdog) return;
  const handle = setInterval(() => {
    const state = getWorkerState();
    if (state.activeJobs.size === 0) return;
    const now = Date.now();
    for (const [index, info] of state.activeJobs) {
      console.log(
        `[scope-refinement] heartbeat `
          + `worker=${index} beat=${info.beatId} `
          + `age=${fmtMs(now - info.startedAt)}`,
      );
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof handle === "object" && handle
    && "unref" in handle
    && typeof (handle as { unref: unknown }).unref
      === "function") {
    (handle as { unref: () => void }).unref();
  }
  g.__scopeRefinementWatchdog = handle;
}

function stopWatchdog(): void {
  if (g.__scopeRefinementWatchdog) {
    clearInterval(g.__scopeRefinementWatchdog);
    g.__scopeRefinementWatchdog = undefined;
  }
}

// ── Public API ────────────────────────────────────────────

export function startScopeRefinementWorker(): void {
  const state = getWorkerState();
  if (state.workers.length > 0) return;

  state.stopping = false;
  state.workerStartedAt = Date.now();
  const notifier = getNotifier();

  onEnqueue(() => notifier.signal());

  for (let i = 0; i < MAX_WORKERS; i++) {
    state.workers.push(workerLoop(i, notifier));
  }

  const pending = getScopeRefinementQueueSize();
  for (let i = 0; i < pending; i++) {
    notifier.signal();
  }

  startWatchdog();
  console.log(
    `[scope-refinement] workers started `
      + `count=${MAX_WORKERS} replayed_signals=${pending}`,
  );
}

export function stopScopeRefinementWorker(): void {
  const state = getWorkerState();
  if (state.workers.length === 0) return;
  state.stopping = true;
  getNotifier().cancelAll();
  state.workers = [];
  stopWatchdog();
  console.log(`[scope-refinement] workers stopped`);
}

export function resetScopeRefinementWorkerState(): void {
  stopScopeRefinementWorker();
  const state = getWorkerState();
  state.retryCounts.clear();
  state.activeJobs.clear();
  state.totalCompleted = 0;
  state.totalFailed = 0;
  state.recentFailures = [];
  state.workerStartedAt = null;
}

export function getScopeRefinementWorkerHealth():
  ScopeRefinementWorkerHealth {
  const state = getWorkerState();
  return {
    workerCount: state.workers.length,
    activeJobs: Array.from(state.activeJobs.values()),
    totalCompleted: state.totalCompleted,
    totalFailed: state.totalFailed,
    recentFailures: [...state.recentFailures],
    uptimeMs: state.workerStartedAt
      ? Date.now() - state.workerStartedAt
      : null,
  };
}

export async function enqueueBeatScopeRefinement(
  beatId: string,
  repoPath?: string,
): Promise<ScopeRefinementJob | null> {
  console.log(
    `[scope-refinement] evaluate beat=${beatId}`
      + ` repo=${repoPath ?? "<none>"}`,
  );
  const agent = await getScopeRefinementAgent();
  if (!agent) {
    console.log(
      `[scope-refinement] skip beat=${beatId} `
        + "reason=no_agent_configured "
        + "(check dispatchMode, "
        + "pools.scope_refinement, "
        + "actions.scopeRefinement)",
    );
    return null;
  }

  startScopeRefinementWorker();
  const job = enqueueScopeRefinementJob({
    beatId,
    repoPath,
  });
  const agentLabel = agent.agentId
    ?? agent.label
    ?? agent.vendor
    ?? "unknown";
  console.log(
    `[scope-refinement] enqueue job=${job.id} `
      + `beat=${beatId} agent=${agentLabel} `
      + `queue_size=${getScopeRefinementQueueSize()}`,
  );
  return job;
}
