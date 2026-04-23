import { getBackend } from "@/lib/backend-instance";
import {
  getScopeRefinementAgent,
  getScopeRefinementSettings,
} from "@/lib/settings";
import {
  dequeueScopeRefinementJob,
  enqueueScopeRefinementJob,
  getScopeRefinementQueueSize,
  onEnqueue,
  type ScopeRefinementJob,
} from "@/lib/scope-refinement-queue";
import {
  recordScopeRefinementCompletion,
} from "@/lib/scope-refinement-events";
import {
  buildRefinementUpdate,
  buildScopeRefinementPrompt,
  parseScopeRefinementOutput,
  runScopeRefinementPrompt,
} from "@/lib/scope-refinement-prompt";
import type {
  ScopeRefinementFailure,
  ScopeRefinementWorkerHealth,
} from "@/lib/types";

const MAX_WORKERS = 2;
const MAX_RETRIES = 2;
const MAX_RECENT_FAILURES = 20;

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

// ── Worker state ──────────────────────────────────────────

interface WorkerState {
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
  __scopeRefinementNotifier?: WorkNotifier;
};

function getWorkerState(): WorkerState {
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

function getNotifier(): WorkNotifier {
  if (!g.__scopeRefinementNotifier) {
    g.__scopeRefinementNotifier = new WorkNotifier();
  }
  return g.__scopeRefinementNotifier;
}

// ── Retry logic ───────────────────────────────────────────

function recordFailure(
  state: WorkerState,
  beatId: string,
  reason: string,
): void {
  state.retryCounts.delete(beatId);
  state.totalFailed++;
  state.recentFailures = [
    { beatId, reason, timestamp: Date.now() },
    ...state.recentFailures,
  ].slice(0, MAX_RECENT_FAILURES);
}

function maybeReenqueue(
  job: ScopeRefinementJob,
  reason: string,
  failedAgentId?: string,
): boolean {
  const state = getWorkerState();
  const retries =
    state.retryCounts.get(job.beatId) ?? 0;
  if (retries >= MAX_RETRIES) {
    console.warn(
      `[scope-refinement] dropping job for `
        + `${job.beatId} after ${retries} retries: `
        + reason,
    );
    recordFailure(state, job.beatId, reason);
    return false;
  }
  const excludeAgentIds = [
    ...(job.excludeAgentIds ?? []),
    ...(failedAgentId ? [failedAgentId] : []),
  ];
  state.retryCounts.set(job.beatId, retries + 1);
  enqueueScopeRefinementJob({
    beatId: job.beatId,
    repoPath: job.repoPath,
    ...(excludeAgentIds.length
      ? { excludeAgentIds }
      : {}),
  });
  console.warn(
    `[scope-refinement] re-enqueued `
      + `${job.beatId} `
      + `(retry ${retries + 1}/${MAX_RETRIES}): `
      + reason,
  );
  return true;
}

// ── Agent resolution with exclusion ──────────────────────

import type { AgentTarget } from "@/lib/types-agent-target";

interface ResolvedAgent {
  agent: AgentTarget;
  agentId: string | undefined;
}

async function resolveJobAgent(
  job: ScopeRefinementJob,
): Promise<ResolvedAgent | null> {
  const exclusions = job.excludeAgentIds?.length
    ? new Set(job.excludeAgentIds)
    : undefined;
  const agent = await getScopeRefinementAgent(
    exclusions,
  );
  if (!agent) {
    const noAlt = exclusions && exclusions.size > 0;
    const reason = noAlt
      ? "no alternative refinement agent available"
        + ` (excluded: `
        + `${[...exclusions].join(", ")})`
      : "no scope refinement agent configured";
    console.warn(
      `[scope-refinement] skipping `
        + `${job.beatId}: ${reason}`,
    );
    if (noAlt) {
      recordFailure(
        getWorkerState(), job.beatId, reason,
      );
    }
    return null;
  }
  const agentId = "agentId" in agent
    ? (agent.agentId as string | undefined)
    : undefined;
  return { agent, agentId };
}

// ── Process a single job ──────────────────────────────────

export async function processScopeRefinementJob(
  job: ScopeRefinementJob,
): Promise<void> {
  console.log(
    `[scope-refinement] processing ${job.beatId}`,
  );
  const settings = await getScopeRefinementSettings();
  const resolved = await resolveJobAgent(job);
  if (!resolved) return;
  const { agent, agentId } = resolved;

  const beatResult = await getBackend().get(
    job.beatId, job.repoPath,
  );
  if (!beatResult.ok || !beatResult.data) {
    const reason =
      "failed to load beat: "
      + (beatResult.error?.message
        ?? beatResult.error
        ?? "unknown error");
    console.warn(
      `[scope-refinement] ${job.beatId}: ${reason}`,
    );
    maybeReenqueue(job, reason);
    return;
  }

  const beat = beatResult.data;
  const prompt = buildScopeRefinementPrompt({
    title: beat.title,
    description: beat.description,
    acceptance: beat.acceptance,
    template: settings.prompt,
  });

  let rawResponse: string;
  try {
    rawResponse = await runScopeRefinementPrompt(
      prompt, job.repoPath, agent,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);
    console.warn(
      `[scope-refinement] agent failed for `
        + `${job.beatId}: ${message}`,
    );
    maybeReenqueue(job, message, agentId);
    return;
  }

  const refined = parseScopeRefinementOutput(
    rawResponse,
  );
  if (!refined) {
    console.warn(
      `[scope-refinement] could not parse agent `
        + `output for ${job.beatId}`,
    );
    maybeReenqueue(
      job, "unparseable agent output", agentId,
    );
    return;
  }

  const update = buildRefinementUpdate(beat, refined);
  if (Object.keys(update).length > 0) {
    const updateResult = await getBackend().update(
      job.beatId, update, job.repoPath,
    );
    if (!updateResult.ok) {
      console.warn(
        `[scope-refinement] failed to update `
          + `${job.beatId}: `
          + (updateResult.error ?? "unknown error"),
      );
      maybeReenqueue(
        job,
        "update failed: "
          + (updateResult.error ?? "unknown"),
      );
      return;
    }
  }

  getWorkerState().retryCounts.delete(job.beatId);
  getWorkerState().totalCompleted++;

  console.log(
    `[scope-refinement] completed ${job.beatId}`,
  );
  recordScopeRefinementCompletion({
    beatId: job.beatId,
    beatTitle: update.title ?? beat.title,
    ...(job.repoPath
      ? { repoPath: job.repoPath }
      : {}),
  });
}

// ── Worker loop ───────────────────────────────────────────

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
    state.activeJobs.set(index, {
      beatId: job.beatId,
      startedAt: Date.now(),
    });
    try {
      await processScopeRefinementJob(job);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      console.warn(
        `[scope-refinement] worker ${index}: `
          + `unexpected error processing `
          + `${job.beatId}: ${message}`,
      );
      maybeReenqueue(job, message);
    } finally {
      state.activeJobs.delete(index);
    }
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
}

export function stopScopeRefinementWorker(): void {
  const state = getWorkerState();
  if (state.workers.length === 0) return;
  state.stopping = true;
  getNotifier().cancelAll();
  state.workers = [];
}

export function resetScopeRefinementWorkerState(
): void {
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
    activeJobs: Array.from(
      state.activeJobs.values(),
    ),
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
    `[scope-refinement] evaluating ${beatId}`
      + ` (repo=${repoPath ?? "<none>"})`,
  );
  const agent = await getScopeRefinementAgent();
  if (!agent) {
    console.log(
      `[scope-refinement] skipped ${beatId}:`
        + " no agent configured"
        + " (check dispatchMode, pools.scope_refinement,"
        + " and actions.scopeRefinement)",
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
    `[scope-refinement] enqueued ${beatId}`
      + ` with agent=${agentLabel}`,
  );
  return job;
}
