/**
 * handleTakeIterationClose and its helpers.
 * Runs after each take-loop child process exits to
 * classify outcomes, persist stats, and decide on retry.
 */
import { getBackend } from "@/lib/backend-instance";
import { loadSettings } from "@/lib/settings";
import {
  isQueueOrTerminal,
  resolveStep,
} from "@/lib/workflows";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  appendOutcomeRecord,
  type AgentOutcomeRecord,
} from "@/lib/agent-outcome-stats";
import {
  appendLeaseAuditEvent,
} from "@/lib/lease-audit";
import {
  normalizeAgentIdentity,
} from "@/lib/agent-identity";
import {
  resolveWorkflowForBeat,
} from "@/lib/terminal-manager-workflow";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  classifyIterationSuccess,
  enforceQueueTerminalInvariant,
} from "@/lib/terminal-manager-take-loop";
import {
  type NextTakeResult,
  buildNextTakePrompt,
} from "@/lib/terminal-manager-take-prompt";
import {
  spawnTakeChild,
} from "@/lib/terminal-manager-take-child";

export async function handleTakeIterationClose(
  ctx: TakeLoopContext,
  exitCode: number | null,
  iterationAgent: CliAgentTarget,
  claimedState: string,
): Promise<void> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const code = exitCode ?? 1;

  if (ctx.sessionAborted()) {
    console.log(`${tag} STOP: session was aborted`);
    ctx.finishSession(code);
    return;
  }

  const postExitState = await fetchPostExitState(ctx);

  ctx.interactionLog.logBeatState({
    beatId: ctx.beatId,
    state: postExitState,
    phase: "after_prompt",
    iteration: ctx.takeIteration.value,
  });

  const resolved = resolveStep(claimedState);
  const success = classifyIterationSuccess(
    code, claimedState, postExitState,
  );
  const altAvailable = await checkAlternativeAgent(
    ctx, iterationAgent, resolved,
  );

  const record = buildOutcomeRecord(
    ctx, iterationAgent, claimedState,
    resolved, code, postExitState,
    altAvailable, success,
  );

  if (code !== 0) {
    await handleErrorExit(
      ctx, record, code, iterationAgent, postExitState,
    );
    return;
  }

  await handleSuccessExit(ctx, record, code);
}

// ─── Sub-helpers ─────────────────────────────────────

async function fetchPostExitState(
  ctx: TakeLoopContext,
): Promise<string> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  try {
    const r = await getBackend().get(
      ctx.beatId, ctx.repoPath,
    );
    if (r.ok && r.data) {
      console.log(
        `${tag} post-close beat state: ` +
        `beat=${ctx.beatId} state=${r.data.state} ` +
        `isAgentClaimable=${r.data.isAgentClaimable}`,
      );
      return r.data.state;
    }
  } catch {
    console.log(
      `${tag} post-close beat fetch failed: ` +
      `beat=${ctx.beatId}`,
    );
  }
  return "unknown";
}

async function checkAlternativeAgent(
  ctx: TakeLoopContext,
  iterationAgent: CliAgentTarget,
  resolved: ReturnType<typeof resolveStep>,
): Promise<boolean> {
  const iterAgentId = iterationAgent.agentId;
  if (!iterAgentId || !resolved) return false;
  try {
    const settings = await loadSettings();
    if (settings.dispatchMode === "advanced") {
      const pool = settings.pools[resolved.step];
      if (pool && pool.length > 0) {
        const valid = pool.filter(
          (e) =>
            e.weight > 0 &&
            settings.agents[e.agentId] &&
            e.agentId !== iterAgentId,
        );
        return valid.length > 0;
      }
    }
  } catch {
    // Settings load failure
  }
  return false;
}

function buildOutcomeRecord(
  ctx: TakeLoopContext,
  iterationAgent: CliAgentTarget,
  claimedState: string,
  resolved: ReturnType<typeof resolveStep>,
  code: number,
  postExitState: string,
  altAvailable: boolean,
  success: boolean,
): AgentOutcomeRecord {
  const durationMs = ctx.claimedAt
    ? Date.now() - ctx.claimedAt : undefined;
  return {
    timestamp: new Date().toISOString(),
    beatId: ctx.beatId,
    sessionId: ctx.id,
    iteration: ctx.takeIteration.value,
    agent: {
      agentId: iterationAgent.agentId,
      label: iterationAgent.label,
      model: iterationAgent.model,
      version: iterationAgent.version,
      command: iterationAgent.command,
    },
    claimedState,
    claimedStep: resolved?.step,
    exitCode: code,
    postExitState,
    rolledBack: false,
    alternativeAgentAvailable: altAvailable,
    success,
    durationMs,
  };
}

async function handleErrorExit(
  ctx: TakeLoopContext,
  record: AgentOutcomeRecord,
  code: number,
  iterationAgent: CliAgentTarget,
  postExitState: string,
): Promise<void> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  console.log(
    `${tag} non-zero exit code=${code} — ` +
    `attempting rollback and retry`,
  );

  let rollbackNeeded = false;
  if (postExitState !== "unknown") {
    const wf = resolveWorkflowForBeat(
      { ...ctx.beat, state: postExitState },
      ctx.workflowsById, ctx.fallbackWorkflow,
    );
    rollbackNeeded = !isQueueOrTerminal(
      postExitState, wf,
    );
  }
  const invariantOk =
    await enforceQueueTerminalInvariant(ctx);
  record.rolledBack = rollbackNeeded && invariantOk;

  Promise.resolve(appendOutcomeRecord(record)).catch(
    (err) => {
      console.error(
        `${tag} failed to write outcome stats:`, err,
      );
    },
  );
  await emitOutcomeAuditEvent(ctx, record);

  const iterAgentId = iterationAgent.agentId;
  if (iterAgentId) {
    try {
      const nextTake = await buildNextTakePrompt(
        ctx, iterAgentId,
      );
      if (nextTake) {
        ctx.takeIteration.value++;
        emitRetryEvents(ctx, nextTake);
        spawnTakeChild(
          ctx, nextTake.prompt,
          nextTake.beatState, nextTake.agentOverride,
        );
        return;
      }
      console.log(
        `${tag} STOP: no retry available ` +
        `(buildNextTakePrompt returned null)`,
      );
    } catch (err) {
      console.error(
        `${tag} error retry ` +
        `buildNextTakePrompt threw:`, err,
      );
    }
  } else {
    console.log(
      `${tag} STOP: no agentId ` +
      `for error retry exclusion`,
    );
  }

  ctx.finishSession(code);
}

async function emitOutcomeAuditEvent(
  ctx: TakeLoopContext,
  record: AgentOutcomeRecord,
): Promise<void> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  const outcome = record.success
    ? "success" as const : "fail" as const;
  const normalized = normalizeAgentIdentity({
    label: record.agent.label,
    model: record.agent.model,
    version: record.agent.version,
    command: record.agent.command,
  });
  await appendLeaseAuditEvent({
    timestamp: new Date().toISOString(),
    beatId: record.beatId,
    sessionId: record.sessionId,
    agent: normalized,
    queueType: record.claimedStep ?? "unknown",
    outcome,
    durationMs: record.durationMs,
  }).catch((err) => {
    console.error(
      `${tag} failed to write outcome ` +
      `audit event:`, err,
    );
  });
  ctx.claimedAt = undefined;
}

function emitRetryEvents(
  ctx: TakeLoopContext,
  nextTake: NextTakeResult,
): void {
  const retryAgent = nextTake.agentOverride ?? ctx.agent;
  const retryLabel =
    retryAgent.label ??
    retryAgent.agentId ??
    retryAgent.command;
  if (nextTake.agentOverride) {
    ctx.pushEvent({
      type: "agent_switch",
      data: JSON.stringify({
        agentName:
          retryAgent.label ??
          retryAgent.agentId ??
          retryAgent.command,
        agentModel: retryAgent.model,
        agentVersion: retryAgent.version,
        agentCommand: retryAgent.command,
      }),
      timestamp: Date.now(),
    });
  }
  ctx.pushEvent({
    type: "stdout",
    data: `\n\x1b[33m--- ` +
      `${new Date().toISOString()} ` +
      `${nextTake.beatState ?? "unknown"} ` +
      `ERROR RETRY ${ctx.takeIteration.value} ` +
      `[agent: ${retryLabel}] ---\x1b[0m\n`,
    timestamp: Date.now(),
  });
  console.log(
    `[terminal-manager] [${ctx.id}] [take-loop] ` +
    `error retry: starting iteration ` +
    `${ctx.takeIteration.value} ` +
    `with agent="${retryLabel}"`,
  );
}

async function handleSuccessExit(
  ctx: TakeLoopContext,
  record: AgentOutcomeRecord,
  code: number,
): Promise<void> {
  const tag =
    `[terminal-manager] [${ctx.id}] [take-loop]`;
  Promise.resolve(appendOutcomeRecord(record)).catch(
    (err) => {
      console.error(
        `${tag} failed to write outcome stats:`, err,
      );
    },
  );
  await emitOutcomeAuditEvent(ctx, record);

  console.log(
    `${tag} evaluating next iteration ` +
    `(code=0, iteration=${ctx.takeIteration.value})`,
  );
  try {
    const nextTake = await buildNextTakePrompt(ctx);
    if (nextTake) {
      ctx.takeIteration.value++;
      emitContinueEvents(ctx, nextTake);
      spawnTakeChild(
        ctx, nextTake.prompt,
        nextTake.beatState, nextTake.agentOverride,
      );
      return;
    }
    console.log(
      `${tag} buildNextTakePrompt returned null ` +
      `— ending session`,
    );
  } catch (err) {
    console.error(
      `${tag} buildNextTakePrompt threw:`, err,
    );
    const beatSlice = ctx.beatId.slice(0, 12);
    const errMsg = err instanceof Error
      ? err.message : String(err);
    ctx.pushEvent({
      type: "stderr",
      data: `[take ${ctx.takeIteration.value} ` +
        `| beat: ${beatSlice}] ` +
        `Take loop check failed: ${errMsg}\n`,
      timestamp: Date.now(),
    });
  }
  await enforceQueueTerminalInvariant(ctx);
  ctx.finishSession(code);
}

function emitContinueEvents(
  ctx: TakeLoopContext,
  nextTake: NextTakeResult,
): void {
  const iterAgent = nextTake.agentOverride ?? ctx.agent;
  const iterLabel =
    iterAgent.label ??
    iterAgent.agentId ??
    iterAgent.command;
  if (nextTake.agentOverride) {
    ctx.pushEvent({
      type: "agent_switch",
      data: JSON.stringify({
        agentName:
          iterAgent.label ??
          iterAgent.agentId ??
          iterAgent.command,
        agentModel: iterAgent.model,
        agentVersion: iterAgent.version,
        agentCommand: iterAgent.command,
      }),
      timestamp: Date.now(),
    });
  }
  ctx.pushEvent({
    type: "stdout",
    data: `\n\x1b[36m--- ` +
      `${new Date().toISOString()} ` +
      `${nextTake.beatState ?? "unknown"} ` +
      `TAKE ${ctx.takeIteration.value} ` +
      `[agent: ${iterLabel}] ---\x1b[0m\n`,
    timestamp: Date.now(),
  });
}
