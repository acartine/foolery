/**
 * buildNextTakePrompt and its sub-helpers.
 * Decides whether the take loop should continue and
 * which agent should claim the next iteration.
 */
import { getBackend } from "@/lib/backend-instance";
import {
  rollbackBeatState,
} from "@/lib/memory-manager-commands";
import type {
  ActionOwnerKind,
  Beat,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import {
  formatAgentDisplayLabel,
} from "@/lib/agent-identity";
import {
  markBeatShipped,
} from "@/lib/lease-audit";
import {
  StepPhase,
  resolveStep,
  workflowActionStateForState,
  workflowOwnerKindForState,
  workflowQueueStateForState,
  workflowStatePhase,
} from "@/lib/workflows";
import {
  resolveWorkflowForBeat,
} from "@/lib/terminal-manager-workflow";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  selectStepAgent,
  handleMaxClaims,
  rotateKnotsLease,
  logClaimFailure,
  finalizeClaim,
} from "@/lib/terminal-manager-take-agent";

export interface NextTakeResult {
  prompt: string;
  beatState: string;
  agentOverride?: import(
    "@/lib/types-agent-target"
  ).CliAgentTarget;
}

export async function buildNextTakePrompt(
  ctx: TakeLoopContext,
  lastErrorAgentId?: string,
): Promise<NextTakeResult | null> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const { beatId, repoPath } = ctx;
  const currentResult = await getBackend().get(
    beatId, repoPath,
  );
  if (!currentResult.ok || !currentResult.data) {
    logFetchFailure(ctx, currentResult);
    return null;
  }
  let current = currentResult.data;
  let workflow = resolveWorkflowForBeat(
    current, ctx.workflowsById, ctx.fallbackWorkflow,
  );
  logBeatState(ctx, current, workflow);

  if (workflow.terminalStates.includes(current.state)) {
    return handleTerminalState(ctx, current);
  }

  let resolved = resolveStep(current.state, workflow);
  let phase = workflowStatePhase(workflow, current.state);
  let stepOwner = workflowOwnerKindForState(
    workflow,
    current.state,
  );
  let stepFailureRollback = false;

  if (
    phase === StepPhase.Active &&
    stepOwner === "agent"
  ) {
    const r = await rollbackStepFailure(
      ctx, current, workflow,
    );
    if (!r) return null;
    current = r.current;
    workflow = r.workflow;
    resolved = r.resolved;
    stepOwner = r.stepOwner;
    phase = workflowStatePhase(workflow, current.state);
    stepFailureRollback = true;
  }

  if (phase !== StepPhase.Queued || stepOwner !== "agent") {
    return handleNotAgentOwned(
      ctx,
      current,
      workflow,
      resolved,
    );
  }

  const queueType =
    workflowActionStateForState(
      workflow,
      current.state,
    ) ?? current.state;
  const count = (
    ctx.claimsPerQueueType.get(queueType) ?? 0
  ) + 1;
  ctx.claimsPerQueueType.set(queueType, count);
  const agentResult = await selectStepAgent(
    ctx, workflow, current.state, queueType,
    stepFailureRollback, lastErrorAgentId,
  );
  if (agentResult === "stop") return null;
  const stepAgentOverride = agentResult.stepAgentOverride;
  const maxClaims = agentResult.maxClaims;

  if (count > maxClaims) {
    return handleMaxClaims(
      ctx, current, queueType, count, maxClaims,
    );
  }
  return buildClaimPromptResult(
    ctx,
    current,
    beatId,
    repoPath,
    queueType,
    stepAgentOverride,
    tag,
  );
}

async function rotateLeaseForClaim(
  ctx: TakeLoopContext,
  currentState: string,
  stepAgentOverride?: import(
    "@/lib/types-agent-target"
  ).CliAgentTarget,
): Promise<boolean> {
  try {
    await rotateKnotsLease(
      ctx,
      stepAgentOverride ?? ctx.agent,
    );
    return true;
  } catch (err) {
    const tag =
      `[terminal-manager] [${ctx.id}] [take-loop]`;
    console.error(
      `${tag} lease rotation failed:`,
      err,
    );
    ctx.pushEvent({
      type: "stderr",
      data:
        `Take loop: lease rotation failed for ${ctx.beatId}\n`,
      timestamp: Date.now(),
    });
    recordTakeLoopLifecycle(ctx, "loop_stop", {
      claimedState: currentState,
      loopDecision:
        `lease_rotation_failed:${String(err)}`,
    });
    return false;
  }
}

async function buildClaimPromptResult(
  ctx: TakeLoopContext,
  current: Beat,
  beatId: string,
  repoPath: string | undefined,
  queueType: string,
  stepAgentOverride?: import(
    "@/lib/types-agent-target"
  ).CliAgentTarget,
  tag?: string,
): Promise<NextTakeResult | null> {
  const rotated = await rotateLeaseForClaim(
    ctx,
    current.state,
    stepAgentOverride,
  );
  if (!rotated) return null;
  ctx.entry.knotsLeaseStep = queueType;

  console.log(
    `${tag ?? "[terminal-manager]"} claiming ` +
    `${beatId} from state=${current.state}`,
  );
  const takeResult = await getBackend().buildTakePrompt(
    beatId,
    { knotsLeaseId: ctx.entry.knotsLeaseId },
    repoPath,
  );
  if (!takeResult.ok || !takeResult.data) {
    logClaimFailure(ctx, takeResult);
    return null;
  }

  return finalizeClaim(
    ctx,
    current,
    queueType,
    stepAgentOverride,
    takeResult.data.prompt,
  );
}

// ─── Sub-helpers ─────────────────────────────────────

function logFetchFailure(
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
    `${tag} get(${ctx.beatId}) failed: ` +
    `ok=${result.ok} error=${err}`,
  );
  recordTakeLoopLifecycle(ctx, "loop_stop", {
    loopDecision: `fetch_failed:${err}`,
  });
  ctx.pushEvent({
    type: "stderr",
    data: `Take loop: failed to fetch ` +
      `${ctx.beatId}: ${err}\n`,
    timestamp: Date.now(),
  });
}

function logBeatState(
  ctx: TakeLoopContext,
  current: Beat,
  workflow: MemoryWorkflowDescriptor,
): void {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  console.log(
    `${tag} beat=${ctx.beatId} ` +
    `state=${current.state} ` +
    `isAgentClaimable=` +
    `${current.isAgentClaimable} ` +
    `profileId=${current.profileId} ` +
    `workflowId=${current.workflowId} ` +
    `nextActionOwnerKind=` +
    `${current.nextActionOwnerKind} ` +
    `requiresHumanAction=` +
    `${current.requiresHumanAction} ` +
    `terminalStates=` +
      `[${workflow.terminalStates}] ` +
      `iteration=${ctx.takeIteration.value}`,
  );
}

function handleTerminalState(
  ctx: TakeLoopContext,
  current: Beat,
): null {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  console.log(
    `${tag} STOP: terminal state ` +
    `"${current.state}"`,
  );
  recordTakeLoopLifecycle(ctx, "loop_stop", {
    claimedState: current.state,
    postExitState: current.state,
    loopDecision: `terminal_state:${current.state}`,
  });
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[33m--- ` +
      `${new Date().toISOString()} ` +
      `${current.state} Take loop stopped: ` +
      `reached terminal state after ` +
      `${ctx.takeIteration.value} iteration(s) ` +
      `---\x1b[0m\n`,
    timestamp: Date.now(),
  });
  markBeatShipped(ctx.beatId).catch((err) => {
    console.error(
      `${tag} failed to mark beat shipped:`, err,
    );
  });
  return null;
}

async function rollbackStepFailure(
  ctx: TakeLoopContext,
  current: Beat,
  workflow: MemoryWorkflowDescriptor,
): Promise<{
  current: Beat;
  workflow: MemoryWorkflowDescriptor;
  resolved: ReturnType<typeof resolveStep>;
  stepOwner: ActionOwnerKind;
} | null> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const rollState = workflowQueueStateForState(
    workflow,
    current.state,
  );
  if (!rollState) {
    console.error(
      `${tag} cannot resolve queue state ` +
      `for active state "${current.state}"`,
    );
    return null;
  }
  const failedAgent =
    formatAgentDisplayLabel(ctx.agent);
  announceStepFailureRollback(
    ctx,
    current,
    rollState,
    failedAgent,
    tag,
  );

  try {
    await rollbackBeatState(
      ctx.beatId, current.state, rollState,
      ctx.repoPath, ctx.memoryManagerType,
      `Foolery take-loop: rolled back from ` +
      `${current.state} to ${rollState} ` +
      `— agent "${failedAgent}" left knot ` +
      `in action state`,
    );
  } catch (err) {
    console.error(
      `${tag} rollback failed ` +
      `for ${ctx.beatId}:`, err,
    );
    recordTakeLoopLifecycle(ctx, "loop_stop", {
      claimedState: current.state,
      loopDecision:
        `step_failure_rollback_failed:${String(err)}`,
    });
    ctx.pushEvent({
      type: "stderr",
      data: `Step failure rollback failed for ` +
        `${ctx.beatId}: ${err}\n`,
      timestamp: Date.now(),
    });
    return null;
  }

  return reloadAfterRollback(
    ctx,
    rollState,
    tag,
  );
}

function announceStepFailureRollback(
  ctx: TakeLoopContext,
  current: Beat,
  rollbackState: string,
  failedAgent: string | undefined,
  tag: string,
): void {
  console.warn(
    `${tag} [STEP_FAILURE] ` +
    `agent "${failedAgent}" ` +
    `left ${ctx.beatId} in active ` +
    `state="${current.state}" — ` +
    `rolling back to "${rollbackState}"`,
  );
  recordTakeLoopLifecycle(ctx, "loop_stop", {
    claimedState: current.state,
    loopDecision:
      `step_failure_rollback:${current.state}->${rollbackState}`,
  });
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[33m--- Step failure: ` +
      `agent "${failedAgent}" ` +
      `left ${ctx.beatId} in active state ` +
      `"${current.state}", rolling back to ` +
      `"${rollbackState}" ---\x1b[0m\n`,
    timestamp: Date.now(),
  });
}

async function reloadAfterRollback(
  ctx: TakeLoopContext,
  rollbackState: string,
  tag: string,
): Promise<{
  current: Beat;
  workflow: MemoryWorkflowDescriptor;
  resolved: ReturnType<typeof resolveStep>;
  stepOwner: ActionOwnerKind;
} | null> {
  const result = await getBackend().get(
    ctx.beatId,
    ctx.repoPath,
  );
  if (!result.ok || !result.data) {
    console.log(
      `${tag} STOP: failed to reload ` +
      `${ctx.beatId} after step failure rollback`,
    );
    recordTakeLoopLifecycle(ctx, "loop_stop", {
      claimedState: rollbackState,
      loopDecision: "reload_after_rollback_failed",
    });
    return null;
  }

  const workflow = resolveWorkflowForBeat(
    result.data,
    ctx.workflowsById,
    ctx.fallbackWorkflow,
  );
  console.log(
    `${tag} step failure rollback result: ` +
    `beat=${ctx.beatId} ` +
    `state=${result.data.state} ` +
    `isAgentClaimable=` +
    `${result.data.isAgentClaimable}`,
  );
  return {
    current: result.data,
    workflow,
    resolved: resolveStep(result.data.state, workflow),
    stepOwner: workflowOwnerKindForState(
      workflow,
      result.data.state,
    ),
  };
}

function handleNotAgentOwned(
  ctx: TakeLoopContext,
  current: Beat,
  workflow: MemoryWorkflowDescriptor,
  resolved: ReturnType<typeof resolveStep>,
): null {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const stepName =
    workflowActionStateForState(
      workflow,
      current.state,
    ) ?? resolved?.step ?? "none";
  const phase =
    workflowStatePhase(workflow, current.state) ??
    "none";
  const ownerKind = workflowOwnerKindForState(
    workflow,
    current.state,
  );
  console.log(
    `${tag} STOP: not agent-owned — ` +
    `state=${current.state} ` +
    `step=${stepName} ` +
    `phase=${phase} ` +
      `stepOwner=${ownerKind}`,
  );
  recordTakeLoopLifecycle(ctx, "loop_stop", {
    claimedState: current.state,
    postExitState: current.state,
    loopDecision:
      `not_agent_owned:${stepName}:${ownerKind}`,
  });
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[33m--- ` +
      `${new Date().toISOString()} ` +
      `${current.state} Take loop stopped: ` +
      `not agent-owned ` +
      `(step=${stepName}, ` +
      `owner=${ownerKind}) ` +
      `after ${ctx.takeIteration.value} ` +
      `iteration(s) ---\x1b[0m\n`,
    timestamp: Date.now(),
  });
  return null;
}
