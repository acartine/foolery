/**
 * Dispatch resolution helpers for the take loop.
 *
 * Extracted from terminal-manager-take-agent.ts to keep
 * that file under the 500-line budget. Owns the
 * cross-agent review fallback policy: when the only
 * remaining candidate in a review pool is the prior
 * action-step agent (e.g. Codex hard-failed and Claude
 * wrote the plan), we drop the cross-agent invariant
 * rather than killing the take. Hard exclusions
 * (failed-agent retry, per-queue failures) are still
 * honored.
 */
import type { FoolerySettings } from "@/lib/schemas";
import type {
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  DispatchFailureError,
  resolveDispatchAgent,
} from "@/lib/dispatch-pool-resolver";
import {
  getLastStepAgent,
  recordStepAgent,
} from "@/lib/agent-pool";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";

export interface DispatchArgs {
  ctx: TakeLoopContext;
  settings: FoolerySettings;
  workflow: MemoryWorkflowDescriptor;
  state: string;
  poolKey: string;
  queueType: string;
  excludeAgentIds: Set<string>;
  isErrorRetry: boolean;
  stepFailureRollback: boolean;
  isReview: boolean;
  priorAction: string | null;
  failedAgentId: string | undefined;
  maxClaims: number;
}

export type DispatchResult =
  | { stepAgentOverride?: CliAgentTarget; maxClaims: number }
  | "stop";

export function runDispatch(a: DispatchArgs): DispatchResult {
  try {
    const selected = resolveDispatchAgent(
      {
        beatId: a.ctx.beatId,
        state: a.state,
        workflow: a.workflow,
        settings: a.settings,
      },
      {
        excludeAgentIds: a.excludeAgentIds,
        strictExclusion: a.isErrorRetry,
      },
    );
    return finalizeDispatchResult(a, selected);
  } catch (err) {
    return handleDispatchError(a, err);
  }
}

function finalizeDispatchResult(
  a: DispatchArgs,
  selected: CliAgentTarget | null,
): {
  stepAgentOverride?: CliAgentTarget;
  maxClaims: number;
} {
  if (!selected) return { maxClaims: a.maxClaims };
  if (selected.agentId) {
    recordStepAgent(a.ctx.beatId, a.poolKey, selected.agentId);
  }
  logSelection(a.ctx, a.poolKey, selected, {
    stepFailureRollback: a.stepFailureRollback,
    isReview: a.isReview,
    excluded: a.excludeAgentIds,
  });
  return { stepAgentOverride: selected, maxClaims: a.maxClaims };
}

function handleDispatchError(
  a: DispatchArgs,
  err: unknown,
): DispatchResult {
  if (!(err instanceof DispatchFailureError)) {
    throw err;
  }
  if (
    err.info.reason === "no_eligible_agent" &&
    a.isReview &&
    a.priorAction
  ) {
    const fallback = retryWithoutCrossAgentExclusion(a);
    if (fallback) return fallback;
  }
  a.ctx.pushEvent({
    type: "stderr",
    data: err.banner,
    timestamp: Date.now(),
  });
  recordTakeLoopLifecycle(a.ctx, "loop_stop", {
    loopDecision:
      `dispatch_failure:${err.info.reason}:${a.poolKey}`,
  });
  return "stop";
}

function retryWithoutCrossAgentExclusion(
  a: DispatchArgs,
): DispatchResult | null {
  const priorAgent = a.priorAction
    ? getLastStepAgent(a.ctx.beatId, a.priorAction) ?? null
    : null;
  const hardExcluded = new Set(
    a.ctx.failedAgentsPerQueueType.get(a.queueType) ?? [],
  );
  if (a.failedAgentId) hardExcluded.add(a.failedAgentId);
  try {
    const selected = resolveDispatchAgent(
      {
        beatId: a.ctx.beatId,
        state: a.state,
        workflow: a.workflow,
        settings: a.settings,
      },
      {
        excludeAgentIds: hardExcluded,
        strictExclusion: a.isErrorRetry,
      },
    );
    if (!selected) return null;
    announceCrossAgentFallback(
      a.ctx, selected, priorAgent, a.poolKey,
    );
    return finalizeDispatchResult(
      { ...a, excludeAgentIds: hardExcluded },
      selected,
    );
  } catch {
    return null;
  }
}

function announceCrossAgentFallback(
  ctx: TakeLoopContext,
  selected: CliAgentTarget,
  priorAgent: string | null,
  poolKey: string,
): void {
  const tag = `[terminal-manager] [${ctx.id}] [take-loop]`;
  const selectedLabel =
    selected.agentId ?? selected.command;
  const priorLabel = priorAgent ?? "the action-step agent";
  console.warn(
    `${tag} cross-agent review fallback: ` +
    `pool="${poolKey}" only "${selectedLabel}" remained ` +
    `after exclusions; relaxing cross-agent invariant ` +
    `(prior action agent="${priorLabel}") rather than ` +
    `stalling the take`,
  );
  recordTakeLoopLifecycle(ctx, "loop_continue", {
    loopDecision:
      `cross_agent_review_fallback:${poolKey}:${selectedLabel}`,
  });
  ctx.pushEvent({
    type: "stderr",
    data: `\x1b[33m--- Cross-agent review fallback: ` +
      `every other agent in pool "${poolKey}" was ` +
      `excluded (hard-failed or unavailable). Letting ` +
      `"${selectedLabel}" review their own ${poolKey} ` +
      `output rather than stopping the take. Review ` +
      `the result carefully. ---\x1b[0m\n`,
    timestamp: Date.now(),
  });
  ctx.pushEvent({
    type: "agent_failure",
    data: JSON.stringify({
      kind: "cross_agent_review_fallback",
      message:
        `Pool "${poolKey}" had only "${selectedLabel}" ` +
        `available after exclusions. Falling back to ` +
        `same-agent review (prior action ` +
        `agent="${priorLabel}"). Review the result.`,
      beatId: ctx.beatId,
    }),
    timestamp: Date.now(),
  });
}

function logSelection(
  ctx: TakeLoopContext,
  poolKey: string,
  selected: CliAgentTarget,
  context: {
    stepFailureRollback: boolean;
    isReview: boolean;
    excluded: ReadonlySet<string>;
  },
): void {
  const tag = `[terminal-manager] [${ctx.id}] [take-loop]`;
  const reason = context.stepFailureRollback
    ? "step failure retry"
    : context.isReview
      ? "cross-agent review"
      : "pool selection";
  const excludedStr =
    context.excluded.size > 0
      ? [...context.excluded].join(", ")
      : "none";
  console.log(
    `${tag} ${reason}: ` +
    `pool="${poolKey}" ` +
    `selected="${selected.agentId ?? selected.command}" ` +
    `(excluded: ${excludedStr})`,
  );
}
