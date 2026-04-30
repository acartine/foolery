/**
 * Agent selection and lease rotation for take-loop.
 *
 * Single unified dispatch path via resolveDispatchAgent — no branching on
 * workflow type, no silent fallbacks, and no hardcoded state literals.
 * Cross-agent review exclusion is driven by the workflow descriptor's
 * reviewQueueStates / transitions, not by a SDLC-specific enum.
 */
import { loadSettings } from "@/lib/settings";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  formatAgentDisplayLabel,
  normalizeAgentIdentity,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  appendLeaseAuditEvent,
  logLeaseAudit,
} from "@/lib/lease-audit";
import {
  wrapExecutionPrompt,
} from "@/lib/agent-prompt-guardrails";
import {
  ensureKnotsLease,
} from "@/lib/knots-lease-runtime";
import {
  recordTakeLoopLifecycle,
  recordLeaseReleaseLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import {
  isReviewStep,
  priorActionStep,
  StepPhase,
} from "@/lib/workflows";
import {
  workflowStatePhase,
} from "@/lib/workflows-runtime";
import {
  getLastStepAgent,
} from "@/lib/agent-pool";
import {
  derivePoolKey,
} from "@/lib/dispatch-pool-resolver";
import type { Beat, MemoryWorkflowDescriptor } from "@/lib/types";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  enforceQueueTerminalInvariant,
} from "@/lib/terminal-manager-take-loop";
import { runDispatch } from "@/lib/terminal-manager-take-dispatch";
import { captureBeatSnapshot } from "@/lib/dispatch-forensics";

// ─── selectStepAgent ─────────────────────────────────

export async function selectStepAgent(
  ctx: TakeLoopContext,
  workflow: MemoryWorkflowDescriptor,
  state: string,
  queueType: string,
  stepFailureRollback: boolean,
  lastErrorAgentId?: string,
): Promise<
  { stepAgentOverride?: CliAgentTarget; maxClaims: number }
  | "stop"
> {
  const settings = await loadSettings();
  const maxClaims = settings.maxClaimsPerQueueType ?? 10;
  const poolKey = derivePoolKey({
    beatId: ctx.beatId,
    state,
    workflow,
    settings,
  });
  if (!poolKey) return { maxClaims };

  const failedAgentId = stepFailureRollback
    ? ctx.agent.agentId
    : lastErrorAgentId;
  const isErrorRetry = !!lastErrorAgentId && !stepFailureRollback;
  const phase = workflowStatePhase(workflow, state);
  const isReview =
    phase === StepPhase.Queued && isReviewStep(poolKey, workflow);
  const priorAction =
    isReview ? priorActionStep(poolKey, workflow) : null;

  const excludeAgentIds = computeExclusions({
    ctx,
    queueType,
    failedAgentId,
    isReview,
    priorAction,
  });

  return runDispatch({
    ctx, settings, workflow, state,
    poolKey, queueType,
    excludeAgentIds, isErrorRetry,
    stepFailureRollback, isReview, priorAction,
    failedAgentId, maxClaims,
  });
}

function computeExclusions(args: {
  ctx: TakeLoopContext;
  queueType: string;
  failedAgentId: string | undefined;
  isReview: boolean;
  priorAction: string | null;
}): Set<string> {
  const excluded = new Set(
    args.ctx.failedAgentsPerQueueType.get(args.queueType) ?? [],
  );
  if (args.failedAgentId) excluded.add(args.failedAgentId);
  if (args.isReview) {
    const activeAgentId = args.ctx.agent.agentId;
    if (activeAgentId) excluded.add(activeAgentId);
    if (args.priorAction) {
      const prior = getLastStepAgent(
        args.ctx.beatId,
        args.priorAction,
      );
      if (prior) excluded.add(prior);
    }
  } else {
    const last =
      args.ctx.lastAgentPerQueueType.get(args.queueType);
    if (last) excluded.add(last);
  }
  return excluded;
}

// ─── handleMaxClaims ─────────────────────────────────

export async function handleMaxClaims(
  ctx: TakeLoopContext,
  current: Beat,
  queueType: string,
  count: number,
  maxClaims: number,
): Promise<null> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  console.log(
    `${tag} STOP: max claims per queue type ` +
    `reached for "${queueType}" ` +
    `(${count}/${maxClaims})`,
  );
  recordTakeLoopLifecycle(ctx, "loop_stop", {
    claimedState: current.state,
    loopDecision:
      `max_claims_reached:${queueType}:${count}/${maxClaims}`,
  });
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[33m--- ${new Date().toISOString()} ` +
      `${current.state} Take loop stopped: ` +
      `max claims per queue type "${queueType}" ` +
      `reached (${count}/${maxClaims}) ` +
      `---\x1b[0m\n`,
    timestamp: Date.now(),
  });
  await enforceQueueTerminalInvariant(ctx);
  return null;
}

// ─── rotateKnotsLease ────────────────────────────────

export async function rotateKnotsLease(
  ctx: TakeLoopContext,
  nextAgent: CliAgentTarget = ctx.agent,
): Promise<void> {
  if (ctx.memoryManagerType !== "knots") return;
  recordTakeLoopLifecycle(ctx, "loop_continue", {
    loopDecision: "rotate_lease_for_next_iteration",
    leaseId: ctx.entry.knotsLeaseId,
  });
  const nextAgentInfo = toExecutionAgentInfo(nextAgent);
  ctx.entry.releaseKnotsLease?.(
    "lease_rotation", "success",
    {
      reason: "next_iteration",
      nextAgent: formatAgentDisplayLabel(nextAgent),
    },
  );
  const newLeaseId = await ensureKnotsLease({
    repoPath: ctx.resolvedRepoPath,
    source: "terminal_manager_take",
    sessionId: ctx.id,
    beatId: ctx.beatId,
    interactionType: "take",
    agentInfo: nextAgentInfo,
  });
  ctx.entry.knotsLeaseId = newLeaseId;
  ctx.entry.knotsLeaseSeq =
    (ctx.entry.knotsLeaseSeq ?? 0) + 1;
  ctx.entry.knotsLeaseAgentInfo = nextAgentInfo;
  ctx.agentInfo = nextAgentInfo;

  ctx.knotsLeaseTerminationStarted.value = false;
  const { terminateKnotsRuntimeLease } =
    await import("@/lib/knots-lease-runtime");
  ctx.entry.releaseKnotsLease = (
    reason: string,
    outcome:
      | "success" | "warning" | "error" = "warning",
    data?: Record<string, unknown>,
  ) => {
    if (ctx.knotsLeaseTerminationStarted.value) return;
    ctx.knotsLeaseTerminationStarted.value = true;
    const leaseId = ctx.entry.knotsLeaseId;
    if (!leaseId) return;
    recordLeaseReleaseLifecycle(
      ctx.entry,
      ctx.interactionLog,
      ctx.id,
      ctx.beatId,
      reason,
      outcome,
      data,
    );
    ctx.entry.lastReleasedKnotsLeaseId = leaseId;
    ctx.entry.knotsLeaseId = undefined;
    ctx.entry.knotsLeaseStep = undefined;
    ctx.entry.knotsLeaseAgentInfo = undefined;
    void terminateKnotsRuntimeLease({
      repoPath: ctx.resolvedRepoPath,
      source: "terminal_manager_take",
      sessionId: ctx.id,
      knotsLeaseId: leaseId,
      beatId: ctx.beatId,
      interactionType: "take",
      agentInfo: ctx.agentInfo,
      reason, outcome, data,
    });
  };
}

// ─── logClaimFailure ─────────────────────────────────

export function logClaimFailure(
  ctx: TakeLoopContext,
  result: {
    ok: boolean;
    error?: { message?: string };
  },
): void {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const err = result.error?.message ?? "no data";
  console.log(
    `${tag} STOP: buildTakePrompt failed — ` +
    `ok=${result.ok} error=${err}`,
  );
  recordTakeLoopLifecycle(ctx, "loop_stop", {
    loopDecision:
      `build_take_prompt_failed:${err}`,
  });
  ctx.pushEvent({
    type: "stderr",
    data: `Take loop: failed to claim ` +
      `${ctx.beatId}: ${err}\n`,
    timestamp: Date.now(),
  });
}

// ─── finalizeClaim ───────────────────────────────────

export async function finalizeClaim(
  ctx: TakeLoopContext,
  current: Beat,
  queueType: string,
  stepAgentOverride: CliAgentTarget | undefined,
  rawPrompt: string,
): Promise<{ prompt: string; beatState: string;
  agentOverride?: CliAgentTarget }> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const claimAgent = stepAgentOverride ?? ctx.agent;
  const claimLabel =
    claimAgent.label ??
    claimAgent.agentId ??
    claimAgent.command;
  if (claimAgent.agentId) {
    ctx.lastAgentPerQueueType.set(
      queueType, claimAgent.agentId,
    );
  }

  const iter = ctx.takeIteration.value + 1;
  console.log(
    `${tag} CONTINUE: claimed ${ctx.beatId} ` +
    `-> iteration ${iter}`,
  );
  recordTakeLoopLifecycle(ctx, "loop_continue", {
    iteration: iter,
    claimedState: current.state,
    leaseId: ctx.entry.knotsLeaseId,
    loopDecision: `claimed:${queueType}`,
  });
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[36m--- ${new Date().toISOString()} ` +
      `${current.state} Claimed ${ctx.beatId} ` +
      `(iteration ${iter}) ` +
      `[agent: ${claimLabel}] ---\x1b[0m\n`,
    timestamp: Date.now(),
  });

  ctx.claimedAt = Date.now();
  const normalized =
    normalizeAgentIdentity(claimAgent);
  await appendLeaseAuditEvent({
    timestamp: new Date().toISOString(),
    beatId: ctx.beatId,
    sessionId: ctx.id,
    agent: normalized,
    queueType, outcome: "claim",
  }).catch((err) => {
    console.error(
      `${tag} failed to write audit event:`, err,
    );
  });

  logLeaseBindingState(ctx, queueType, claimAgent);

  const claimAgentInfo = toExecutionAgentInfo(claimAgent);
  void captureBeatSnapshot("pre_prompt_send", {
    sessionId: ctx.id,
    beatId: ctx.beatId,
    repoPath: ctx.resolvedRepoPath,
    leaseId: ctx.entry.knotsLeaseId,
    iteration: ctx.takeIteration.value + 1,
    observedState: current.state,
    expectedStep: queueType,
    agentInfo: claimAgentInfo,
  });
  void logLeaseAudit({
    event: "prompt_delivered",
    repoPath: ctx.resolvedRepoPath,
    sessionId: ctx.id,
    knotsLeaseId: ctx.entry.knotsLeaseId,
    beatId: ctx.beatId,
    claimedId: ctx.beatId,
    interactionType: "take",
    agentName: claimAgentInfo.agentName,
    agentProvider: claimAgentInfo.agentProvider,
    agentModel: claimAgentInfo.agentModel,
    agentVersion: claimAgentInfo.agentVersion,
    outcome: "success",
    message:
      `Prompt delivered to agent for ` +
      `${queueType}.`,
    data: {
      queueType,
      leaseSequence: ctx.entry.knotsLeaseSeq,
      promptLength: rawPrompt.length,
      hasLeaseInPrompt:
        rawPrompt.includes("--lease"),
    },
  }).catch(() => {});

  return {
    prompt: wrapExecutionPrompt(rawPrompt, "take"),
    beatState: current.state,
    agentOverride: stepAgentOverride,
  };
}

function logLeaseBindingState(
  ctx: TakeLoopContext,
  queueType: string,
  claimAgent: CliAgentTarget,
): void {
  const claimAgentInfo = toExecutionAgentInfo(claimAgent);
  const leaseAgentInfo = ctx.entry.knotsLeaseAgentInfo;
  const leaseId = ctx.entry.knotsLeaseId;
  const previousLeaseId = ctx.entry.lastReleasedKnotsLeaseId;
  const leaseStep = ctx.entry.knotsLeaseStep;
  const agentMatchesLease =
    leaseAgentInfo?.agentProvider === claimAgentInfo.agentProvider &&
    leaseAgentInfo?.agentModel === claimAgentInfo.agentModel &&
    leaseAgentInfo?.agentVersion === claimAgentInfo.agentVersion;
  const stepMatchesLease = leaseStep === queueType;
  const isBrandNewLease =
    Boolean(leaseId) && leaseId !== previousLeaseId;

  void Promise.resolve(logLeaseAudit({
    event: "lease_claim_binding_check",
    repoPath: ctx.resolvedRepoPath,
    sessionId: ctx.id,
    knotsLeaseId: leaseId,
    beatId: ctx.beatId,
    claimedId: ctx.beatId,
    interactionType: "take",
    agentName: claimAgentInfo.agentName,
    agentProvider: claimAgentInfo.agentProvider,
    agentModel: claimAgentInfo.agentModel,
    agentVersion: claimAgentInfo.agentVersion,
    outcome:
      leaseId && agentMatchesLease && stepMatchesLease && isBrandNewLease
        ? "success"
        : "error",
    message: `Lease binding check for ${queueType}.`,
    data: {
      queueType,
      leaseSequence: ctx.entry.knotsLeaseSeq,
      leaseStep,
      leaseAgentInfo,
      claimAgentInfo,
      agentMatchesLease,
      stepMatchesLease,
      isBrandNewLease,
      previousLeaseId,
    },
  })).catch((err) => {
    console.error(
      `[terminal-manager] [${ctx.id}] [take-loop] ` +
      `failed to write lease binding check:`,
      err,
    );
  });
}
