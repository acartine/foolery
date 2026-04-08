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
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  markBeatShipped,
} from "@/lib/lease-audit";
import {
  StepPhase,
  queueStateForStep,
  resolveStep,
} from "@/lib/workflows";
import {
  resolveWorkflowForBeat,
} from "@/lib/terminal-manager-workflow";
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

  let resolved = resolveStep(current.state);
  let stepOwner = resolved
    ? workflow.owners?.[resolved.step] ?? "agent"
    : "none";
  let stepFailureRollback = false;

  if (
    resolved?.phase === StepPhase.Active &&
    stepOwner === "agent"
  ) {
    const r = await rollbackStepFailure(
      ctx, current, resolved,
    );
    if (!r) return null;
    current = r.current;
    workflow = r.workflow;
    resolved = r.resolved;
    stepOwner = r.stepOwner;
    stepFailureRollback = true;
  }

  if (!resolved || stepOwner !== "agent") {
    return handleNotAgentOwned(ctx, current, resolved);
  }

  const queueType = resolved.step;
  const count =
    (ctx.claimsPerQueueType.get(queueType) ?? 0) + 1;
  ctx.claimsPerQueueType.set(queueType, count);

  const agentResult = await selectStepAgent(
    ctx, resolved, queueType,
    stepFailureRollback, lastErrorAgentId,
  );
  if (agentResult === "stop") return null;
  const { stepAgentOverride, maxClaims } = agentResult;

  if (count > maxClaims) {
    return handleMaxClaims(
      ctx, current, queueType, count, maxClaims,
    );
  }

  try {
    await rotateKnotsLease(
      ctx,
      stepAgentOverride ?? ctx.agent,
    );
  } catch (err) {
    const tag =
      `[terminal-manager] [${ctx.id}] [take-loop]`;
    console.error(
      `${tag} lease rotation failed:`, err,
    );
    ctx.pushEvent({
      type: "stderr",
      data: `Take loop: lease rotation failed ` +
        `for ${ctx.beatId}\n`,
      timestamp: Date.now(),
    });
    return null;
  }
  ctx.entry.knotsLeaseStep = queueType;

  console.log(
    `${tag} claiming ${beatId} ` +
    `from state=${current.state}`,
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
    ctx, current, queueType,
    stepAgentOverride, takeResult.data.prompt,
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
  resolved: NonNullable<
    ReturnType<typeof resolveStep>
  >,
): Promise<{
  current: Beat;
  workflow: MemoryWorkflowDescriptor;
  resolved: ReturnType<typeof resolveStep>;
  stepOwner: ActionOwnerKind;
} | null> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const rollState =
    queueStateForStep(resolved.step);
  const failedAgent =
    toExecutionAgentInfo(ctx.agent).agentName;
  console.warn(
    `${tag} [STEP_FAILURE] ` +
    `agent "${failedAgent}" ` +
    `left ${ctx.beatId} in active ` +
    `state="${current.state}" — ` +
    `rolling back to "${rollState}"`,
  );
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[33m--- Step failure: ` +
      `agent "${failedAgent}" ` +
      `left ${ctx.beatId} ` +
      `in active state "${current.state}", ` +
      `rolling back to "${rollState}" ` +
      `---\x1b[0m\n`,
    timestamp: Date.now(),
  });

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
    ctx.pushEvent({
      type: "stderr",
      data: `Step failure rollback failed for ` +
        `${ctx.beatId}: ${err}\n`,
      timestamp: Date.now(),
    });
    return null;
  }

  const rr = await getBackend().get(
    ctx.beatId, ctx.repoPath,
  );
  if (!rr.ok || !rr.data) {
    console.log(
      `${tag} STOP: failed to reload ` +
      `${ctx.beatId} after step failure rollback`,
    );
    return null;
  }

  const wf = resolveWorkflowForBeat(
    rr.data, ctx.workflowsById,
    ctx.fallbackWorkflow,
  );
  const newR = resolveStep(rr.data.state);
  const newOwner = newR
    ? wf.owners?.[newR.step] ?? "agent" : "none";
  console.log(
    `${tag} step failure rollback result: ` +
    `beat=${ctx.beatId} ` +
    `state=${rr.data.state} ` +
    `isAgentClaimable=` +
    `${rr.data.isAgentClaimable}`,
  );
  return {
    current: rr.data, workflow: wf,
    resolved: newR, stepOwner: newOwner,
  };
}

function handleNotAgentOwned(
  ctx: TakeLoopContext,
  current: Beat,
  resolved: ReturnType<typeof resolveStep>,
): null {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const stepName = resolved?.step ?? "none";
  const phase = resolved?.phase ?? "none";
  const wf = resolveWorkflowForBeat(
    current, ctx.workflowsById,
    ctx.fallbackWorkflow,
  );
  const ownerKind = resolved
    ? wf.owners?.[resolved.step] ?? "agent"
    : "none";
  console.log(
    `${tag} STOP: not agent-owned — ` +
    `state=${current.state} ` +
    `step=${stepName} ` +
    `phase=${phase} ` +
    `stepOwner=${ownerKind}`,
  );
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
