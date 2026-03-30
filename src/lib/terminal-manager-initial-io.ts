/**
 * I/O wiring for the initial child process.
 * Extracted from terminal-manager-initial-child.ts
 * to stay under the 500-line file limit.
 */
import type { ChildProcess } from "node:child_process";
import type { InteractionLog } from "@/lib/interaction-logger";
import type {
  createLineNormalizer,
  AgentDialect,
} from "@/lib/agent-adapter";
import { logTokenUsageForEvent } from "@/lib/agent-token-usage";
import type {
  TerminalEvent,
} from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  type JsonObject,
  toObject,
  buildAutoAskUserResponse,
  makeUserMessageLine,
  formatStreamEvent,
  pushFormattedEvent,
} from "@/lib/terminal-manager-format";
import {
  type TakeLoopContext,
  enforceQueueTerminalInvariant,
  handleTakeIterationClose,
} from "@/lib/terminal-manager-take-loop";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import {
  INPUT_CLOSE_GRACE_MS,
} from "@/lib/terminal-manager-types";
import type {
  PreparedTargets,
} from "@/lib/terminal-manager-session-prep";

// ─── InitialChildState ──────────────────────────────

export interface InitialChildState {
  stdinClosed: boolean;
  closeInputTimer: NodeJS.Timeout | null;
  autoAnsweredToolUseIds: Set<string>;
  executionPromptSent: boolean;
  shipCompletionPromptSent: boolean;
  autoShipCompletionPrompt: string | null;
  lineBuffer: string;
}

export function createInitialChildState(
  isInteractive: boolean,
  autoShipCompletionPrompt: string | null,
): InitialChildState {
  return {
    stdinClosed: !isInteractive,
    closeInputTimer: null,
    autoAnsweredToolUseIds: new Set(),
    executionPromptSent: true,
    shipCompletionPromptSent: false,
    autoShipCompletionPrompt,
    lineBuffer: "",
  };
}

// ─── Stdin helpers ───────────────────────────────────

export function closeInput(
  child: ChildProcess,
  state: InitialChildState,
): void {
  if (state.stdinClosed) return;
  if (state.closeInputTimer) {
    clearTimeout(state.closeInputTimer);
    state.closeInputTimer = null;
  }
  state.stdinClosed = true;
  child.stdin?.end();
}

function cancelInputClose(
  state: InitialChildState,
): void {
  if (!state.closeInputTimer) return;
  clearTimeout(state.closeInputTimer);
  state.closeInputTimer = null;
}

function scheduleInputClose(
  child: ChildProcess,
  state: InitialChildState,
): void {
  cancelInputClose(state);
  state.closeInputTimer = setTimeout(
    () => closeInput(child, state),
    INPUT_CLOSE_GRACE_MS,
  );
}

export function sendUserTurn(
  child: ChildProcess,
  state: InitialChildState,
  interactionLog: InteractionLog,
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
    interactionLog.logPrompt(text, { source });
    return true;
  } catch {
    return false;
  }
}

function resultFollowUp(
  child: ChildProcess,
  state: InitialChildState,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
): boolean {
  if (
    !state.autoShipCompletionPrompt ||
    !state.executionPromptSent ||
    state.shipCompletionPromptSent
  ) {
    return false;
  }
  const sent = sendUserTurn(
    child, state, interactionLog,
    state.autoShipCompletionPrompt,
    "ship_completion_follow_up",
  );
  if (sent) {
    state.shipCompletionPromptSent = true;
    pushEvent({
      type: "stdout",
      data: "\x1b[33m-> Auto-sent ship completion " +
        "follow-up prompt\x1b[0m\n",
      timestamp: Date.now(),
    });
    return true;
  }
  pushEvent({
    type: "stderr",
    data: "Failed to send ship completion " +
      "follow-up prompt.\n",
    timestamp: Date.now(),
  });
  return false;
}

function autoAnswerAskUser(
  child: ChildProcess,
  state: InitialChildState,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
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
      typeof block.id === "string"
        ? block.id : null;
    if (
      !toolUseId ||
      state.autoAnsweredToolUseIds.has(toolUseId)
    ) continue;
    state.autoAnsweredToolUseIds.add(toolUseId);
    const resp =
      buildAutoAskUserResponse(block.input);
    const sent = sendUserTurn(
      child, state, interactionLog,
      resp, "auto_ask_user_response",
    );
    if (sent) {
      pushEvent({
        type: "stdout",
        data: `\x1b[33m-> Auto-answered ` +
          `AskUserQuestion ` +
          `(${toolUseId.slice(0, 12)}...)` +
          `\x1b[0m\n`,
        timestamp: Date.now(),
      });
    } else {
      pushEvent({
        type: "stderr",
        data: "Failed to send auto-response " +
          "for AskUserQuestion.\n",
        timestamp: Date.now(),
      });
    }
  }
}

// ─── Stream wiring ───────────────────────────────────

export function wireStdout(
  child: ChildProcess,
  id: string,
  beatIds: string[],
  dialect: AgentDialect,
  interactionLog: InteractionLog,
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
  pushEvent: (evt: TerminalEvent) => void,
  state: InitialChildState,
): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    interactionLog.logStdout(chunk.toString());
    state.lineBuffer += chunk.toString();
    const lines = state.lineBuffer.split("\n");
    state.lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      interactionLog.logResponse(line);
      processStdoutLine(
        child,
        id,
        beatIds,
        dialect,
        state,
        interactionLog,
        normalizeEvent, pushEvent, line,
      );
    }
  });
}

function processStdoutLine(
  child: ChildProcess,
  id: string,
  beatIds: string[],
  dialect: AgentDialect,
  state: InitialChildState,
  interactionLog: InteractionLog,
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
  pushEvent: (evt: TerminalEvent) => void,
  line: string,
): void {
  try {
    const raw = JSON.parse(line) as JsonObject;
    logTokenUsageForEvent(
      interactionLog,
      dialect,
      raw,
      beatIds,
    );
    const obj = (normalizeEvent(raw) ?? raw) as
      Record<string, unknown>;
    autoAnswerAskUser(
      child, state, interactionLog,
      pushEvent, obj,
    );
    if (obj.type === "result") {
      if (
        !resultFollowUp(
          child, state, interactionLog,
          pushEvent,
        )
      ) {
        scheduleInputClose(child, state);
      }
    } else {
      cancelInputClose(state);
    }
    const display = formatStreamEvent(obj);
    if (display) {
      const evtType = display.isDetail
        ? "stdout_detail" : "stdout";
      const slice = display.text
        .slice(0, 150).replace(/\n/g, "\\n");
      console.log(
        `[terminal-manager] [${id}] display ` +
        `(${display.text.length} chars, ` +
        `${evtType}): ${slice}`,
      );
      pushEvent({
        type: evtType,
        data: display.text,
        timestamp: Date.now(),
      });
    }
  } catch {
    console.log(
      `[terminal-manager] [${id}] ` +
      `raw stdout: ${line.slice(0, 150)}`,
    );
    pushEvent({
      type: "stdout",
      data: line + "\n",
      timestamp: Date.now(),
    });
  }
}

export function wireStderr(
  child: ChildProcess,
  id: string,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
): void {
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    interactionLog.logStderr(text);
    console.log(
      `[terminal-manager] [${id}] stderr: ` +
      `${text.slice(0, 200)}`,
    );
    pushEvent({
      type: "stderr", data: text,
      timestamp: Date.now(),
    });
  });
}

// ─── Close / Error handlers ─────────────────────────

export function wireClose(
  child: ChildProcess,
  id: string,
  beatId: string,
  isTakeLoop: boolean,
  state: InitialChildState,
  entry: SessionEntry,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
  finishSession: (code: number) => void,
  agent: CliAgentTarget,
  prepared: PreparedTargets,
  takeLoopCtx: TakeLoopContext,
): void {
  child.on("close", (code, signal) => {
    flushLineBuffer(
      child, state, interactionLog, pushEvent,
    );
    logClose(
      id, beatId, isTakeLoop, code, signal,
      entry.buffer.length,
    );
    if (state.closeInputTimer) {
      clearTimeout(state.closeInputTimer);
      state.closeInputTimer = null;
    }
    state.stdinClosed = true;
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;

    if (isTakeLoop) {
      handleTakeIterationClose(
        takeLoopCtx, code, agent,
        prepared.beat.state ?? "unknown",
      ).catch((err) => {
        console.error(
          `[terminal-manager] [${id}] ` +
          `[take-loop] ` +
          `handleTakeIterationClose error:`,
          err,
        );
        finishSession(code ?? 1);
      });
      return;
    }

    (async () => {
      await enforceQueueTerminalInvariant(
        takeLoopCtx,
      );
      finishSession(code ?? 1);
    })();
  });
}

function logClose(
  id: string,
  beatId: string,
  isTakeLoop: boolean,
  code: number | null,
  signal: string | null,
  bufLen: number,
): void {
  if (isTakeLoop) {
    console.log(
      `[terminal-manager] [${id}] [take-loop] ` +
      `initial child close: code=${code} ` +
      `signal=${signal} beat=${beatId}`,
    );
  } else {
    console.log(
      `[terminal-manager] [${id}] close: ` +
      `code=${code} signal=${signal} ` +
      `buffer=${bufLen} events`,
    );
  }
}

function flushLineBuffer(
  child: ChildProcess,
  state: InitialChildState,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
): void {
  if (!state.lineBuffer.trim()) return;
  interactionLog.logResponse(state.lineBuffer);
  try {
    const obj = JSON.parse(
      state.lineBuffer,
    ) as JsonObject;
    autoAnswerAskUser(
      child, state, interactionLog,
      pushEvent, obj,
    );
    if (obj.type === "result") {
      if (
        !resultFollowUp(
          child, state, interactionLog,
          pushEvent,
        )
      ) {
        scheduleInputClose(child, state);
      }
    } else {
      cancelInputClose(state);
    }
    const display = formatStreamEvent(obj);
    if (display) {
      pushFormattedEvent(display, pushEvent);
    }
  } catch {
    pushEvent({
      type: "stdout",
      data: state.lineBuffer + "\n",
      timestamp: Date.now(),
    });
  }
  state.lineBuffer = "";
}

export function wireError(
  child: ChildProcess,
  id: string,
  isTakeLoop: boolean,
  state: InitialChildState,
  entry: SessionEntry,
  pushEvent: (evt: TerminalEvent) => void,
  finishSession: (code: number) => void,
  agent: CliAgentTarget,
  prepared: PreparedTargets,
  takeLoopCtx: TakeLoopContext,
): void {
  child.on("error", (err) => {
    console.error(
      `[terminal-manager] [${id}] spawn error:`,
      err.message,
    );
    if (state.closeInputTimer) {
      clearTimeout(state.closeInputTimer);
      state.closeInputTimer = null;
    }
    state.stdinClosed = true;
    pushEvent({
      type: "stderr",
      data: `Process error: ${err.message}\n`,
      timestamp: Date.now(),
    });
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;
    if (isTakeLoop) {
      handleTakeIterationClose(
        takeLoopCtx, 1, agent,
        prepared.beat.state ?? "unknown",
      ).catch((e) => {
        console.error(
          `[terminal-manager] [${id}] ` +
          `handleTakeIterationClose error ` +
          `after spawn error:`, e,
        );
        finishSession(1);
      });
    } else {
      enforceQueueTerminalInvariant(
        takeLoopCtx,
      ).finally(() => { finishSession(1); });
    }
  });
}
