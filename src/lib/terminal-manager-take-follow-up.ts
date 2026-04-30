/**
 * Take-loop turn-ended follow-up handler (foolery-6881).
 *
 * Wires `onTurnEnded` into every take-loop iteration so
 * iterations 2, 3, 4… have the same in-session follow-up
 * capability the initial child got in foolery-a401. When
 * the active agent's turn ends but the beat is still in
 * an active (non-queue, non-terminal) state, we prompt
 * it to finish advancing or roll back before exiting.
 *
 * DO NOT:
 *   - Skip wiring this handler in a new take-loop runtime
 *     factory. That is the fake-fix this knot eradicates.
 *   - Always return `false` (a functional no-op).
 *   - Re-introduce a payload-shape gate like
 *     `if (obj.type === "result")` — foolery-a401 removed
 *     that gate and it belongs nowhere in this pipeline.
 */
import type { ChildProcess } from "node:child_process";
import type { AgentSessionRuntime } from "@/lib/agent-session-runtime";
import { getBackend } from "@/lib/backend-instance";
import { listLeases } from "@/lib/knots";
import { isQueueOrTerminal } from "@/lib/workflows";
import {
  resolveWorkflowForBeat,
} from "@/lib/terminal-manager-workflow";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import { captureBeatSnapshot } from "@/lib/dispatch-forensics";
import { logLeaseAudit } from "@/lib/lease-audit";
import {
  emitDispatchFailureBanner,
  type LeaseDeadDispatchFailure,
  type LeaseDeadDispatchFailureReason,
} from "@/lib/dispatch-pool-resolver";

// ── Constants ──────────────────────────────────────────

const FOLLOW_UP_SOURCE = "take_loop_follow_up";

/**
 * Maximum consecutive in-iteration follow-up prompts
 * permitted while the beat state stays the same.
 *
 * The take-loop follow-up exists to nudge agents that
 * exit too early after a single turn. In practice, an
 * agent that hasn't advanced after this many follow-ups
 * is either looping (e.g. kimi-k2.6 emitting step_finish
 * without invoking tools, knots-a08a 2026-04-29) or
 * trapped behind a broken transport that synthesizes
 * `{type: "result"}` on every HTTP failure
 * (foolery-e780 2026-04-29). Either way, more prompts
 * over the same session won't help — give up and let
 * `handleTakeIterationClose` reassess.
 */
const MAX_FOLLOW_UPS_PER_STATE = 5;

// ── Prompt builder ────────────────────────────────────

export function buildTakeLoopFollowUpPrompt(
  beatId: string,
  state: string,
): string {
  return [
    `Your turn ended but beat \`${beatId}\` is still in ` +
      `state \`${state}\`.`,
    "Either complete the action to advance the knot, " +
      "or run `kno rollback` if you cannot proceed.",
    "Do not exit without advancing or rolling back.",
  ].join(" ");
}

// ── Observability ─────────────────────────────────────

function emitFollowUpPushEvent(
  ctx: TakeLoopContext,
  beatId: string,
  state: string,
): void {
  ctx.pushEvent({
    type: "stdout",
    data:
      `\x1b[33m--- Take-loop follow-up prompt sent ` +
      `because knot ${beatId} in state ${state} ` +
      `---\x1b[0m\n`,
    timestamp: Date.now(),
  });
}

// ── Core handler ──────────────────────────────────────

async function fetchBeatStateOrNull(
  ctx: TakeLoopContext,
): Promise<string | null> {
  try {
    const result = await getBackend().get(
      ctx.beatId, ctx.repoPath,
    );
    if (!result.ok || !result.data) return null;
    return result.data.state;
  } catch (err) {
    console.error(
      `[terminal-manager] [${ctx.id}] [take-loop] ` +
      `onTurnEnded beat fetch failed:`,
      err,
    );
    return null;
  }
}

function resolveCtxWorkflow(
  ctx: TakeLoopContext,
  state: string,
): boolean {
  const beatForWorkflow = {
    ...ctx.beat,
    state,
  };
  const workflow = resolveWorkflowForBeat(
    beatForWorkflow,
    ctx.workflowsById,
    ctx.fallbackWorkflow,
  );
  return isQueueOrTerminal(state, workflow);
}

/**
 * Lease-state gate. Fails closed: if we cannot prove the lease is
 * still in lease_ready / lease_active, we refuse to send the
 * follow-up. The agent's prompt embeds the lease id, so prompting
 * with a dead lease guarantees a `kno claim` failure loop
 * (foolery-2dd7 / maestro-ca91 incident).
 */
const HEALTHY_LEASE_STATES = new Set(["lease_ready", "lease_active"]);

export interface LeaseHealthChecker {
  list(repoPath?: string): Promise<{
    ok: boolean;
    data?: Array<{ id?: string | null; state?: string }>;
    error?: string;
  }>;
}

function defaultLeaseHealthChecker(): LeaseHealthChecker {
  return {
    list: async (repoPath) => {
      const r = await listLeases(repoPath, true);
      if (!r.ok) {
        return { ok: false, error: r.error ?? "listLeases failed" };
      }
      return {
        ok: true,
        data: (r.data ?? []) as Array<{ id?: string | null; state?: string }>,
      };
    },
  };
}

interface LeaseHealthResult {
  healthy: boolean;
  reason?: LeaseDeadDispatchFailureReason;
  leaseState?: string;
  detail?: string;
}

export async function evaluateLeaseHealth(
  leaseId: string | undefined,
  repoPath: string | undefined,
  checker: LeaseHealthChecker,
): Promise<LeaseHealthResult> {
  if (!leaseId) {
    return {
      healthy: false,
      reason: "lease_missing",
      detail: "ctx.entry.knotsLeaseId is undefined",
    };
  }
  const list = await checker.list(repoPath);
  if (!list.ok) {
    return {
      healthy: false,
      reason: "lease_state_unknown",
      detail: list.error,
    };
  }
  const lease = (list.data ?? []).find((l) => l.id === leaseId);
  if (!lease) {
    return {
      healthy: false,
      reason: "lease_missing",
      detail: `lease ${leaseId} not present in lease list`,
    };
  }
  const state = typeof lease.state === "string" ? lease.state : undefined;
  if (state && HEALTHY_LEASE_STATES.has(state)) {
    return { healthy: true, leaseState: state };
  }
  return {
    healthy: false,
    reason: "lease_terminated",
    leaseState: state,
    detail: `lease state ${state ?? "<unknown>"} is not in {lease_ready, lease_active}`,
  };
}

function buildLeaseDeadFailure(
  ctx: TakeLoopContext,
  state: string,
  health: LeaseHealthResult,
): LeaseDeadDispatchFailure {
  return {
    kind: "lease_dead",
    beatId: ctx.beatId,
    sessionId: ctx.id,
    iteration: ctx.takeIteration.value,
    leaseId: ctx.entry.knotsLeaseId,
    leaseState: health.leaseState,
    beatState: state,
    expectedStep: ctx.entry.knotsLeaseStep,
    agentName: ctx.agentInfo?.agentName,
    agentProvider: ctx.agentInfo?.agentProvider,
    agentModel: ctx.agentInfo?.agentModel,
    agentVersion: ctx.agentInfo?.agentVersion,
    followUpCount: ctx.followUpAttempts.count,
    promptSource: FOLLOW_UP_SOURCE,
    reason: health.reason ?? "lease_state_unknown",
    detail: health.detail,
  };
}

async function refuseFollowUpForDeadLease(
  ctx: TakeLoopContext,
  state: string,
  health: LeaseHealthResult,
): Promise<void> {
  const failure = buildLeaseDeadFailure(ctx, state, health);
  const banner = emitDispatchFailureBanner(failure);
  ctx.pushEvent({
    type: "stderr",
    data: banner,
    timestamp: Date.now(),
  });
  recordTakeLoopLifecycle(
    ctx,
    "take_loop_follow_up_skipped_dead_lease",
    { claimedState: state, leaseId: ctx.entry.knotsLeaseId },
  );
  await logLeaseAudit({
    event: "lease_dead_on_followup",
    repoPath: ctx.resolvedRepoPath,
    sessionId: ctx.id,
    knotsLeaseId: ctx.entry.knotsLeaseId,
    beatId: ctx.beatId,
    interactionType: "take",
    agentName: ctx.agentInfo?.agentName,
    agentProvider: ctx.agentInfo?.agentProvider,
    agentModel: ctx.agentInfo?.agentModel,
    agentVersion: ctx.agentInfo?.agentVersion,
    outcome: "error",
    message:
      `Refused to send take-loop follow-up — lease ` +
      `${ctx.entry.knotsLeaseId ?? "<missing>"} is ${health.leaseState ?? "in unknown state"}.`,
    data: {
      reason: failure.reason,
      detail: failure.detail,
      leaseState: failure.leaseState,
      beatState: state,
      iteration: failure.iteration,
      expectedStep: failure.expectedStep,
      followUpCount: failure.followUpCount,
      promptSource: failure.promptSource,
    },
  }).catch((err) => {
    console.error(
      `[terminal-manager] [${ctx.id}] [take-loop] ` +
      `failed to write lease_dead_on_followup audit:`, err,
    );
  });
}

async function sendFollowUpPrompt(
  ctx: TakeLoopContext,
  runtime: AgentSessionRuntime,
  child: ChildProcess,
  state: string,
  leaseChecker: LeaseHealthChecker = defaultLeaseHealthChecker(),
): Promise<boolean> {
  void captureBeatSnapshot("pre_followup", {
    sessionId: ctx.id,
    beatId: ctx.beatId,
    repoPath: ctx.resolvedRepoPath,
    leaseId: ctx.entry.knotsLeaseId,
    iteration: ctx.takeIteration.value,
    observedState: state,
    expectedStep: ctx.entry.knotsLeaseStep,
    agentInfo: ctx.agentInfo,
    childPid: typeof child.pid === "number" ? child.pid : undefined,
  });

  const health = await evaluateLeaseHealth(
    ctx.entry.knotsLeaseId,
    ctx.resolvedRepoPath,
    leaseChecker,
  );
  if (!health.healthy) {
    await refuseFollowUpForDeadLease(ctx, state, health);
    return false;
  }

  const prompt = buildTakeLoopFollowUpPrompt(
    ctx.beatId, state,
  );
  const sent = runtime.sendUserTurn(
    child, prompt, FOLLOW_UP_SOURCE,
  );
  if (sent) {
    recordTakeLoopLifecycle(
      ctx,
      "take_loop_follow_up_sent",
      { claimedState: state },
    );
    emitFollowUpPushEvent(ctx, ctx.beatId, state);
    return true;
  }
  console.warn(
    `[terminal-manager] [${ctx.id}] [take-loop] ` +
    `failed to send follow-up prompt for ` +
    `beat=${ctx.beatId} state=${state}`,
  );
  return false;
}

function emitFollowUpCapBanner(
  ctx: TakeLoopContext,
  beatId: string,
  state: string,
  count: number,
): void {
  ctx.pushEvent({
    type: "stderr",
    data:
      `\x1b[31m--- Take-loop follow-up cap reached: ` +
      `knot ${beatId} stuck in state ${state} after ` +
      `${count} consecutive follow-up prompts. ` +
      `Closing session so the take loop can reassess. ` +
      `---\x1b[0m\n`,
    timestamp: Date.now(),
  });
}

function recordFollowUpProgress(
  ctx: TakeLoopContext,
  state: string,
): number {
  if (ctx.followUpAttempts.lastState !== state) {
    ctx.followUpAttempts.count = 0;
    ctx.followUpAttempts.lastState = state;
  }
  ctx.followUpAttempts.count += 1;
  return ctx.followUpAttempts.count;
}

export async function handleTakeLoopTurnEnded(
  ctx: TakeLoopContext,
  runtime: AgentSessionRuntime,
  child: ChildProcess,
): Promise<boolean> {
  const state = await fetchBeatStateOrNull(ctx);
  if (!state) return false;
  if (resolveCtxWorkflow(ctx, state)) {
    // Agent advanced the knot; let the runtime's
    // grace-period close logic run as normal.
    ctx.followUpAttempts.count = 0;
    ctx.followUpAttempts.lastState = state;
    return false;
  }
  const count = recordFollowUpProgress(ctx, state);
  if (count > MAX_FOLLOW_UPS_PER_STATE) {
    console.warn(
      `[terminal-manager] [${ctx.id}] [take-loop] ` +
      `follow-up cap reached for beat=${ctx.beatId} ` +
      `state=${state} count=${count} — stopping ` +
      `in-iteration follow-ups`,
    );
    emitFollowUpCapBanner(ctx, ctx.beatId, state, count);
    return false;
  }
  return await sendFollowUpPrompt(ctx, runtime, child, state);
}
