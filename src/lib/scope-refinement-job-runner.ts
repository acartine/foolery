import { getBackend } from "@/lib/backend-instance";
import {
  getScopeRefinementAgent,
  getScopeRefinementSettings,
} from "@/lib/settings";
import {
  enqueueScopeRefinementJob,
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
import type { AgentTarget } from "@/lib/types-agent-target";
import {
  MAX_RECENT_FAILURES,
  fmtMs,
  getWorkerState,
  tag,
  type WorkerState,
} from "@/lib/scope-refinement-worker-state";

const MAX_RETRIES = 2;

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
  const retries = state.retryCounts.get(job.beatId) ?? 0;
  if (retries >= MAX_RETRIES) {
    console.warn(
      `[scope-refinement] drop job=${job.id} `
        + `beat=${job.beatId} retries=${retries} `
        + `reason=${reason}`,
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
    `[scope-refinement] requeue job=${job.id} `
      + `beat=${job.beatId} `
      + `retry=${retries + 1}/${MAX_RETRIES} `
      + `reason=${reason}`,
  );
  return true;
}

// ── Agent resolution with exclusion ──────────────────────

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
  const agent = await getScopeRefinementAgent(exclusions);
  if (!agent) {
    const noAlt = exclusions && exclusions.size > 0;
    const reason = noAlt
      ? "no alternative refinement agent available"
        + ` (excluded: `
        + `${[...exclusions].join(", ")})`
      : "no scope refinement agent configured";
    console.warn(
      `[scope-refinement] skip job=${job.id} `
        + `beat=${job.beatId}: ${reason}`,
    );
    if (noAlt) {
      recordFailure(getWorkerState(), job.beatId, reason);
    }
    return null;
  }
  const agentId = "agentId" in agent
    ? (agent.agentId as string | undefined)
    : undefined;
  return { agent, agentId };
}

// ── Process a single job ──────────────────────────────────

interface JobLog {
  prefix: string;
  start: number;
  phase: (name: string, dt?: number, extra?: string) => void;
  warn: (msg: string) => void;
}

function makeJobLog(job: ScopeRefinementJob): JobLog {
  const prefix = tag(job.id, job.beatId);
  const start = Date.now();
  return {
    prefix,
    start,
    phase: (name, dt, extra) => {
      const total = fmtMs(Date.now() - start);
      const dtPart = dt !== undefined
        ? ` dt=${fmtMs(dt)}`
        : "";
      const extraPart = extra ? ` ${extra}` : "";
      console.log(
        `${prefix} phase=${name}${dtPart}`
          + ` total=${total}${extraPart}`,
      );
    },
    warn: (msg) => {
      console.warn(`${prefix} ${msg}`);
    },
  };
}

async function loadBeatOrFail(
  job: ScopeRefinementJob,
  log: JobLog,
): Promise<{
  title: string;
  description?: string;
  acceptance?: string;
} | null> {
  const tFetch = Date.now();
  const beatResult = await getBackend().get(
    job.beatId, job.repoPath,
  );
  log.phase(
    "beat_fetched",
    Date.now() - tFetch,
    `ok=${beatResult.ok}`,
  );
  if (!beatResult.ok || !beatResult.data) {
    const reason = "failed to load beat: "
      + (beatResult.error?.message
        ?? beatResult.error
        ?? "unknown error");
    log.warn(`phase=fail reason=${reason}`);
    maybeReenqueue(job, reason);
    return null;
  }
  return beatResult.data;
}

async function runAgentOrFail(
  job: ScopeRefinementJob,
  agent: AgentTarget,
  agentId: string | undefined,
  prompt: string,
  log: JobLog,
): Promise<string | null> {
  const tRun = Date.now();
  try {
    const out = await runScopeRefinementPrompt(
      prompt, job.repoPath, agent,
    );
    log.phase(
      "agent_completed",
      Date.now() - tRun,
      `bytes=${out.length}`,
    );
    return out;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);
    log.warn(
      `phase=agent_failed `
        + `dt=${fmtMs(Date.now() - tRun)} `
        + `reason=${message}`,
    );
    maybeReenqueue(job, message, agentId);
    return null;
  }
}

async function applyUpdateOrFail(
  job: ScopeRefinementJob,
  update: {
    title?: string;
    description?: string;
    acceptance?: string;
  },
  log: JobLog,
): Promise<boolean> {
  if (Object.keys(update).length === 0) {
    log.phase("no_changes");
    return true;
  }
  const tUpdate = Date.now();
  const updateResult = await getBackend().update(
    job.beatId, update, job.repoPath,
  );
  log.phase(
    "beat_updated",
    Date.now() - tUpdate,
    `ok=${updateResult.ok} `
      + `fields=${Object.keys(update).join(",")}`,
  );
  if (!updateResult.ok) {
    log.warn(
      `phase=update_failed `
        + `reason=${updateResult.error ?? "unknown"}`,
    );
    maybeReenqueue(
      job,
      "update failed: "
        + (updateResult.error ?? "unknown"),
    );
    return false;
  }
  return true;
}

export async function processScopeRefinementJob(
  job: ScopeRefinementJob,
): Promise<void> {
  const log = makeJobLog(job);
  log.phase("start");

  const tSettings = Date.now();
  const settings = await getScopeRefinementSettings();
  log.phase("settings_loaded", Date.now() - tSettings);

  const tResolve = Date.now();
  const resolved = await resolveJobAgent(job);
  if (!resolved) {
    log.phase("agent_unresolved");
    return;
  }
  const { agent, agentId } = resolved;
  log.phase(
    "agent_resolved",
    Date.now() - tResolve,
    `agent=${agentId ?? agent.label ?? agent.command}`,
  );

  const beat = await loadBeatOrFail(job, log);
  if (!beat) return;

  const prompt = buildScopeRefinementPrompt({
    title: beat.title,
    description: beat.description,
    acceptance: beat.acceptance,
    template: settings.prompt,
  });
  log.phase("prompt_built", undefined, `bytes=${prompt.length}`);

  const rawResponse = await runAgentOrFail(
    job, agent, agentId, prompt, log,
  );
  if (rawResponse === null) return;

  const refined = parseScopeRefinementOutput(rawResponse);
  if (!refined) {
    log.warn("phase=parse_failed");
    maybeReenqueue(
      job, "unparseable agent output", agentId,
    );
    return;
  }
  log.phase("parsed");

  const update = buildRefinementUpdate(beat, refined);
  const applied = await applyUpdateOrFail(job, update, log);
  if (!applied) return;

  getWorkerState().retryCounts.delete(job.beatId);
  getWorkerState().totalCompleted++;

  log.phase("done");
  recordScopeRefinementCompletion({
    beatId: job.beatId,
    beatTitle: update.title ?? beat.title,
    ...(job.repoPath ? { repoPath: job.repoPath } : {}),
  });
}
