/**
 * Take-loop child process spawning and I/O wiring.
 * Extracted from terminal-manager-take-loop.ts
 * to stay under the 500-line file limit.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  buildPromptModeArgs,
  resolveDialect,
  createLineNormalizer,
  type AgentDialect,
} from "@/lib/agent-adapter";
import { logTokenUsageForEvent } from "@/lib/agent-token-usage";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  agentDisplayName,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import {
  type JsonObject,
  toObject,
  buildAutoAskUserResponse,
  makeUserMessageLine,
  formatStreamEvent,
  pushFormattedEvent,
} from "@/lib/terminal-manager-format";
import {
  resolveAgentCommand,
  INPUT_CLOSE_GRACE_MS,
} from "@/lib/terminal-manager-types";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";
import { handleTakeIterationClose } from "@/lib/terminal-manager-take-loop";

// ─── Types ───────────────────────────────────────────

interface ChildIoState {
  stdinClosed: boolean;
  lineBuffer: string;
  closeInputTimer: NodeJS.Timeout | null;
  autoAnsweredIds: Set<string>;
}

// ─── spawnTakeChild (entry point) ────────────────────

export function spawnTakeChild(
  ctx: TakeLoopContext,
  takePrompt: string,
  beatState?: string,
  agentOverride?: CliAgentTarget,
): void {
  const effectiveAgent = agentOverride ?? ctx.agent;
  ctx.agent = effectiveAgent;
  ctx.agentInfo = toExecutionAgentInfo(effectiveAgent);
  ctx.session.agentName = agentDisplayName(effectiveAgent);
  ctx.session.agentModel = effectiveAgent.model;
  ctx.session.agentVersion = effectiveAgent.version;
  ctx.session.agentCommand = effectiveAgent.command;
  const effectiveDialect = resolveDialect(
    effectiveAgent.command,
  );
  const isInteractive = effectiveDialect === "claude";

  const { cmd, args } = buildSpawnArgs(
    effectiveAgent, isInteractive, takePrompt,
  );
  const normalizeEvent = createLineNormalizer(
    effectiveDialect,
  );

  const takeChild = spawn(cmd, args, {
    cwd: ctx.cwd,
    stdio: [
      isInteractive ? "pipe" : "ignore",
      "pipe", "pipe",
    ],
    detached: true,
  });
  ctx.entry.process = takeChild;

  console.log(
    `[terminal-manager] [${ctx.id}] [take-loop] ` +
    `iteration ${ctx.takeIteration.value}: ` +
    `pid=${takeChild.pid ?? "failed"} ` +
    `beat=${ctx.beatId} ` +
    `beat_state=${beatState ?? "unknown"}`,
  );

  const state: ChildIoState = {
    stdinClosed: !isInteractive,
    lineBuffer: "",
    closeInputTimer: null,
    autoAnsweredIds: new Set(),
  };

  wireStdout(
    ctx,
    takeChild,
    state,
    effectiveDialect,
    normalizeEvent,
  );
  wireStderr(ctx, takeChild);
  wireClose(
    ctx,
    takeChild,
    state,
    effectiveAgent,
    effectiveDialect,
    beatState,
  );
  wireError(
    ctx, takeChild, state,
    effectiveAgent, effectiveDialect, beatState,
  );
  logAndSendPrompt(
    ctx, takeChild, state,
    isInteractive, effectiveDialect,
    takePrompt, beatState,
  );
}

// ─── Spawn args ──────────────────────────────────────

function buildSpawnArgs(
  agent: CliAgentTarget,
  isInteractive: boolean,
  takePrompt: string,
): { cmd: string; args: string[] } {
  let cmd: string;
  let args: string[];
  if (isInteractive) {
    cmd = agent.command;
    args = [
      "-p", "--input-format", "stream-json",
      "--verbose", "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (agent.model) args.push("--model", agent.model);
  } else {
    const built = buildPromptModeArgs(agent, takePrompt);
    cmd = built.command;
    args = built.args;
  }
  cmd = resolveAgentCommand(cmd);
  return { cmd, args };
}

// ─── Stdin helpers ───────────────────────────────────

function closeInput(
  child: ChildProcess,
  state: ChildIoState,
): void {
  if (state.stdinClosed) return;
  if (state.closeInputTimer) {
    clearTimeout(state.closeInputTimer);
    state.closeInputTimer = null;
  }
  state.stdinClosed = true;
  child.stdin?.end();
}

function cancelInputClose(state: ChildIoState): void {
  if (!state.closeInputTimer) return;
  clearTimeout(state.closeInputTimer);
  state.closeInputTimer = null;
}

function scheduleInputClose(
  child: ChildProcess,
  state: ChildIoState,
): void {
  cancelInputClose(state);
  state.closeInputTimer = setTimeout(
    () => closeInput(child, state),
    INPUT_CLOSE_GRACE_MS,
  );
}

function sendUserTurn(
  ctx: TakeLoopContext,
  child: ChildProcess,
  state: ChildIoState,
  text: string,
  source = "manual",
): boolean {
  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded ||
    state.stdinClosed
  ) {
    return false;
  }
  cancelInputClose(state);
  const line = makeUserMessageLine(text);
  try {
    child.stdin.write(line);
    ctx.interactionLog.logPrompt(text, { source });
    return true;
  } catch {
    return false;
  }
}

// ─── Auto-answer AskUserQuestion ─────────────────────

function autoAnswerAskUser(
  ctx: TakeLoopContext,
  child: ChildProcess,
  state: ChildIoState,
  obj: JsonObject,
): void {
  if (obj.type !== "assistant") return;
  const msg = toObject(obj.message);
  const content = msg?.content;
  if (!Array.isArray(content)) return;
  for (const rawBlock of content) {
    const block = toObject(rawBlock);
    if (!block) continue;
    if (
      block.type !== "tool_use" ||
      block.name !== "AskUserQuestion"
    ) continue;
    const toolUseId =
      typeof block.id === "string" ? block.id : null;
    if (
      !toolUseId ||
      state.autoAnsweredIds.has(toolUseId)
    ) continue;
    state.autoAnsweredIds.add(toolUseId);
    const resp = buildAutoAskUserResponse(block.input);
    const sent = sendUserTurn(
      ctx, child, state, resp, "auto_ask_user_response",
    );
    if (sent) {
      ctx.pushEvent({
        type: "stdout",
        data: `\x1b[33m-> Auto-answered ` +
          `AskUserQuestion ` +
          `(${toolUseId.slice(0, 12)}...)\x1b[0m\n`,
        timestamp: Date.now(),
      });
    }
  }
}

// ─── Stream wiring ───────────────────────────────────

function wireStdout(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  state: ChildIoState,
  dialect: AgentDialect,
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
): void {
  takeChild.stdout?.on("data", (chunk: Buffer) => {
    ctx.interactionLog.logStdout(chunk.toString());
    state.lineBuffer += chunk.toString();
    const lines = state.lineBuffer.split("\n");
    state.lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      ctx.interactionLog.logResponse(line);
      try {
        const raw = JSON.parse(line) as JsonObject;
        logTokenUsageForEvent(
          ctx.interactionLog,
          dialect,
          raw,
          [ctx.beatId],
        );
        const obj = (normalizeEvent(raw) ?? raw) as
          Record<string, unknown>;
        autoAnswerAskUser(
          ctx, takeChild, state, obj,
        );
        if (obj.type === "result") {
          scheduleInputClose(takeChild, state);
        } else {
          cancelInputClose(state);
        }
        const display = formatStreamEvent(obj);
        if (display) {
          pushFormattedEvent(display, ctx.pushEvent);
        }
      } catch {
        ctx.pushEvent({
          type: "stdout",
          data: line + "\n",
          timestamp: Date.now(),
        });
      }
    }
  });
}

function wireStderr(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
): void {
  takeChild.stderr?.on("data", (chunk: Buffer) => {
    ctx.interactionLog.logStderr(chunk.toString());
    ctx.pushEvent({
      type: "stderr",
      data: chunk.toString(),
      timestamp: Date.now(),
    });
  });
}

// ─── Close / Error ───────────────────────────────────

function wireClose(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  state: ChildIoState,
  effectiveAgent: CliAgentTarget,
  effectiveDialect: AgentDialect,
  beatState: string | undefined,
): void {
  takeChild.on("close", (takeCode) => {
    flushLineBuffer(
      ctx,
      takeChild,
      state,
      effectiveDialect,
    );
    if (state.closeInputTimer) {
      clearTimeout(state.closeInputTimer);
      state.closeInputTimer = null;
    }
    state.stdinClosed = true;
    takeChild.stdout?.removeAllListeners();
    takeChild.stderr?.removeAllListeners();
    ctx.entry.process = null;

    console.log(
      `[terminal-manager] [${ctx.id}] [take-loop] ` +
      `child close: code=${takeCode} ` +
      `iteration=${ctx.takeIteration.value} ` +
      `beat=${ctx.beatId} ` +
      `aborted=${ctx.sessionAborted()}`,
    );

    handleTakeIterationClose(
      ctx, takeCode, effectiveAgent,
      beatState ?? "unknown",
    ).catch((err) => {
      console.error(
        `[terminal-manager] [${ctx.id}] [take-loop] ` +
        `handleTakeIterationClose error:`, err,
      );
      ctx.finishSession(takeCode ?? 1);
    });
  });
}

function flushLineBuffer(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  state: ChildIoState,
  dialect: AgentDialect,
): void {
  if (!state.lineBuffer.trim()) return;
  ctx.interactionLog.logResponse(state.lineBuffer);
  try {
    const obj = JSON.parse(
      state.lineBuffer,
    ) as JsonObject;
    logTokenUsageForEvent(
      ctx.interactionLog,
      dialect,
      obj,
      [ctx.beatId],
    );
    autoAnswerAskUser(ctx, takeChild, state, obj);
    if (obj.type === "result") {
      scheduleInputClose(takeChild, state);
    }
    const display = formatStreamEvent(obj);
    if (display) {
      pushFormattedEvent(display, ctx.pushEvent);
    }
  } catch {
    ctx.pushEvent({
      type: "stdout",
      data: state.lineBuffer + "\n",
      timestamp: Date.now(),
    });
  }
  state.lineBuffer = "";
}

function wireError(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  state: ChildIoState,
  effectiveAgent: CliAgentTarget,
  effectiveDialect: string,
  beatState: string | undefined,
): void {
  const errorPrefix =
    `[take ${ctx.takeIteration.value} ` +
    `| beat: ${ctx.beatId.slice(0, 12)} ` +
    `| agent: ${effectiveDialect}]`;

  takeChild.on("error", (err) => {
    console.error(
      `[terminal-manager] [${ctx.id}] [take-loop] ` +
      `spawn error:`, err.message,
    );
    if (state.closeInputTimer) {
      clearTimeout(state.closeInputTimer);
      state.closeInputTimer = null;
    }
    state.stdinClosed = true;
    ctx.pushEvent({
      type: "stderr",
      data: `${errorPrefix} Process error: ` +
        `${err.message}\n`,
      timestamp: Date.now(),
    });
    takeChild.stdout?.removeAllListeners();
    takeChild.stderr?.removeAllListeners();
    ctx.entry.process = null;
    handleTakeIterationClose(
      ctx, 1, effectiveAgent,
      beatState ?? "unknown",
    ).catch((e) => {
      console.error(
        `[terminal-manager] [${ctx.id}] [take-loop] ` +
        `handleTakeIterationClose error ` +
        `after spawn error:`, e,
      );
      ctx.finishSession(1);
    });
  });
}

function logAndSendPrompt(
  ctx: TakeLoopContext,
  takeChild: ChildProcess,
  state: ChildIoState,
  isInteractive: boolean,
  dialect: string,
  takePrompt: string,
  beatState: string | undefined,
): void {
  ctx.interactionLog.logBeatState({
    beatId: ctx.beatId,
    state: beatState ?? "unknown",
    phase: "before_prompt",
    iteration: ctx.takeIteration.value,
  });

  if (isInteractive) {
    const iter = ctx.takeIteration.value;
    const sent = sendUserTurn(
      ctx, takeChild, state,
      takePrompt, `take_${iter}`,
    );
    if (!sent) {
      closeInput(takeChild, state);
      const pfx =
        `[take ${iter} ` +
        `| beat: ${ctx.beatId.slice(0, 12)} ` +
        `| agent: ${dialect}]`;
      ctx.pushEvent({
        type: "stderr",
        data: `${pfx} Failed to send prompt ` +
          `— stdin is closed or unavailable.\n`,
        timestamp: Date.now(),
      });
      takeChild.kill("SIGTERM");
      ctx.entry.process = null;
      ctx.finishSession(1);
    }
  } else {
    ctx.interactionLog.logPrompt(takePrompt, {
      source: `take_${ctx.takeIteration.value}`,
    });
  }
}
