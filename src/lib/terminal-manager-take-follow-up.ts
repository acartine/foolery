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
import { isQueueOrTerminal } from "@/lib/workflows";
import {
  resolveWorkflowForBeat,
} from "@/lib/terminal-manager-workflow";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";

// ── Constants ──────────────────────────────────────────

const FOLLOW_UP_SOURCE = "take_loop_follow_up";

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

function sendFollowUpPrompt(
  ctx: TakeLoopContext,
  runtime: AgentSessionRuntime,
  child: ChildProcess,
  state: string,
): boolean {
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
    return false;
  }
  return sendFollowUpPrompt(ctx, runtime, child, state);
}
