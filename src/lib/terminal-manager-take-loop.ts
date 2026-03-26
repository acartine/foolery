/**
 * Take-loop context and invariant enforcement.
 * This module defines the shared TakeLoopContext and
 * re-exports sub-module functions for convenience.
 */
import { EventEmitter } from "node:events";
import { getBackend } from "@/lib/backend-instance";
import type { MemoryManagerType } from "@/lib/memory-managers";
import {
  rollbackBeatState,
} from "@/lib/memory-manager-commands";
import type {
  TerminalSession,
  TerminalEvent,
  Beat,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  isQueueOrTerminal,
  nextQueueStateForStep,
  priorQueueStateForStep,
  queueStateForStep,
  resolveStep,
} from "@/lib/workflows";
import type { InteractionLog } from "@/lib/interaction-logger";
import {
  resolveWorkflowForBeat,
} from "@/lib/terminal-manager-workflow";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";

// ─── Shared context for take-loop closures ───────────

export interface TakeLoopContext {
  id: string;
  beatId: string;
  beat: Beat;
  repoPath: string | undefined;
  resolvedRepoPath: string;
  cwd: string;
  memoryManagerType: MemoryManagerType;
  workflowsById: Map<string, MemoryWorkflowDescriptor>;
  fallbackWorkflow: MemoryWorkflowDescriptor;
  agent: CliAgentTarget;
  agentInfo: ReturnType<
    typeof import("@/lib/agent-identity")
      .toExecutionAgentInfo
  >;
  entry: SessionEntry;
  session: TerminalSession;
  interactionLog: InteractionLog;
  emitter: EventEmitter;
  pushEvent: (evt: TerminalEvent) => void;
  finishSession: (exitCode: number) => void;
  sessionAborted: () => boolean;
  knotsLeaseTerminationStarted: { value: boolean };
  takeIteration: { value: number };
  claimsPerQueueType: Map<string, number>;
  lastAgentPerQueueType: Map<string, string>;
}

// ─── enforceQueueTerminalInvariant ───────────────────

export async function enforceQueueTerminalInvariant(
  ctx: TakeLoopContext,
): Promise<boolean> {
  const tag =
    `[terminal-manager] [${ctx.id}] [invariant]`;
  const currentResult = await getBackend().get(
    ctx.beatId, ctx.repoPath,
  );
  if (!currentResult.ok || !currentResult.data) {
    console.log(
      `${tag} failed to fetch beat state ` +
      `for invariant check`,
    );
    return true;
  }

  const current = currentResult.data;
  const workflow = resolveWorkflowForBeat(
    current, ctx.workflowsById, ctx.fallbackWorkflow,
  );

  if (isQueueOrTerminal(current.state, workflow)) {
    console.log(
      `${tag} beat=${ctx.beatId} ` +
      `state=${current.state} — invariant satisfied`,
    );
    await checkDanglingLease(ctx, tag);
    return true;
  }

  return await rollbackInvariantViolation(
    ctx, current, tag,
  );
}

async function checkDanglingLease(
  ctx: TakeLoopContext,
  tag: string,
): Promise<void> {
  if (ctx.memoryManagerType !== "knots") return;
  try {
    const { showKnot, terminateLease } =
      await import("@/lib/knots");
    const knotResult = await showKnot(
      ctx.beatId, ctx.repoPath,
    );
    if (knotResult.ok && knotResult.data?.lease_id) {
      const leaseId = knotResult.data.lease_id;
      console.warn(
        `${tag} knot ${ctx.beatId} has dangling ` +
        `lease ${leaseId} — terminating`,
      );
      await terminateLease(
        leaseId, ctx.repoPath,
      ).catch((err) => {
        console.error(
          `${tag} failed to terminate ` +
          `dangling lease ${leaseId}:`, err,
        );
      });
    }
  } catch (err) {
    console.error(
      `${tag} failed to check for dangling ` +
      `lease on ${ctx.beatId}:`, err,
    );
  }
}

async function rollbackInvariantViolation(
  ctx: TakeLoopContext,
  current: Beat,
  tag: string,
): Promise<boolean> {
  console.warn(
    `${tag} [WARN] beat=${ctx.beatId} ` +
    `state=${current.state} — ` +
    `VIOLATION: action state on exit`,
  );
  ctx.pushEvent({
    type: "stdout",
    data: `\x1b[33m--- Invariant violation: ` +
      `beat ${ctx.beatId} in action state ` +
      `"${current.state}" after agent exit ` +
      `---\x1b[0m\n`,
    timestamp: Date.now(),
  });

  const resolved = resolveStep(current.state);
  if (!resolved) {
    console.error(
      `${tag} cannot resolve step for state ` +
      `"${current.state}" — skipping rollback`,
    );
    return false;
  }

  const rollbackState = queueStateForStep(resolved.step);
  console.warn(
    `${tag} [WARN] rolling back from ` +
    `"${current.state}" to "${rollbackState}"`,
  );

  try {
    await rollbackBeatState(
      ctx.beatId, current.state, rollbackState,
      ctx.repoPath, ctx.memoryManagerType,
    );
    ctx.pushEvent({
      type: "stdout",
      data: `\x1b[33m--- Invariant fix: ` +
        `rolled back ${ctx.beatId} from ` +
        `"${current.state}" to ` +
        `"${rollbackState}" ---\x1b[0m\n`,
      timestamp: Date.now(),
    });
    console.warn(
      `${tag} [WARN] rollback succeeded ` +
      `for ${ctx.beatId}`,
    );
  } catch (err) {
    console.error(`${tag} rollback failed:`, err);
    ctx.pushEvent({
      type: "stderr",
      data: `Invariant enforcement: ` +
        `failed to roll back ${ctx.beatId} from ` +
        `${current.state} to ${rollbackState}: ` +
        `${err}\n`,
      timestamp: Date.now(),
    });
    return false;
  }

  return await verifyInvariantAfterRollback(ctx, tag);
}

async function verifyInvariantAfterRollback(
  ctx: TakeLoopContext,
  tag: string,
): Promise<boolean> {
  const refreshed = await getBackend().get(
    ctx.beatId, ctx.repoPath,
  );
  if (refreshed.ok && refreshed.data) {
    const w = resolveWorkflowForBeat(
      refreshed.data,
      ctx.workflowsById,
      ctx.fallbackWorkflow,
    );
    if (isQueueOrTerminal(refreshed.data.state, w)) {
      console.log(
        `${tag} beat=${ctx.beatId} ` +
        `state=${refreshed.data.state} — ` +
        `invariant satisfied after rollback`,
      );
      return true;
    }
    console.error(
      `${tag} beat=${ctx.beatId} ` +
      `state=${refreshed.data.state} — ` +
      `STILL VIOLATED after rollback`,
    );
  }
  return false;
}

// ─── classifyIterationSuccess ────────────────────────

export function classifyIterationSuccess(
  exitCode: number,
  claimedState: string,
  postExitState: string,
): boolean {
  if (exitCode !== 0) return false;
  const resolved = resolveStep(claimedState);
  if (!resolved) return false;
  const nextQueue = nextQueueStateForStep(resolved.step);
  const priorQueue =
    priorQueueStateForStep(resolved.step);
  if (nextQueue && postExitState === nextQueue) {
    return true;
  }
  if (priorQueue && postExitState === priorQueue) {
    return true;
  }
  return false;
}

// ─── Re-exports for convenience ──────────────────────

export {
  buildNextTakePrompt,
  type NextTakeResult,
} from "@/lib/terminal-manager-take-prompt";

export {
  handleTakeIterationClose,
} from "@/lib/terminal-manager-take-iteration";

export {
  spawnTakeChild,
} from "@/lib/terminal-manager-take-child";
