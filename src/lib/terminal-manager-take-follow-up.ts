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
  return sendFollowUpPrompt(ctx, runtime, child, state);
}
