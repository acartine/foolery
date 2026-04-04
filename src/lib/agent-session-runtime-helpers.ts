/**
 * Stdin operations, AskUser auto-response, and watchdog
 * logic extracted from agent-session-runtime.ts.
 */
import type { ChildProcess } from "node:child_process";
import {
  type JsonObject,
  toObject,
  buildAutoAskUserResponse,
  makeUserMessageLine,
  makeCopilotUserMessageLine,
} from "@/lib/terminal-manager-format";
import {
  INPUT_CLOSE_GRACE_MS,
} from "@/lib/terminal-manager-types";
import type {
  SessionRuntimeState,
  SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import {
  terminateProcessGroup,
} from "@/lib/agent-session-runtime";

// ── Stdin operations ───────────────────────────────────

export function doCloseInput(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  if (state.stdinClosed) return;
  doCancelInputClose(state);
  config.jsonrpcSession?.interruptTurn(child);
  config.httpSession?.interruptTurn(child);
  config.acpSession?.interruptTurn(child);
  state.stdinClosed = true;
  child.stdin?.end();
}

export function doCancelInputClose(
  state: SessionRuntimeState,
): void {
  if (!state.closeInputTimer) return;
  clearTimeout(state.closeInputTimer);
  state.closeInputTimer = null;
}

export function doScheduleInputClose(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  doCancelInputClose(state);
  state.closeInputTimer = setTimeout(
    () => doCloseInput(child, state, config),
    INPUT_CLOSE_GRACE_MS,
  );
}

export function doSendUserTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  text: string,
  source: string,
): boolean {
  // HTTP transport: no stdin guard needed
  if (config.httpSession) {
    if (state.stdinClosed) return false;
    doCancelInputClose(state);
    const sent =
      config.httpSession.startTurn(child, text);
    if (sent) {
      state.resultObserved = false;
      state.exitReason = null;
      doResetWatchdog(child, state, config);
      config.interactionLog.logPrompt(
        text, { source },
      );
    }
    return sent;
  }

  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded ||
    state.stdinClosed
  ) {
    return false;
  }
  doCancelInputClose(state);

  const resetForNewTurn = () => {
    state.resultObserved = false;
    state.exitReason = null;
    doResetWatchdog(child, state, config);
  };

  // JSON-RPC transport: use startTurn()
  if (config.jsonrpcSession) {
    const sent =
      config.jsonrpcSession.startTurn(child, text);
    if (sent) {
      resetForNewTurn();
      config.interactionLog.logPrompt(
        text, { source },
      );
    }
    return sent;
  }

  // ACP transport: use startTurn()
  if (config.acpSession) {
    const sent =
      config.acpSession.startTurn(child, text);
    if (sent) {
      resetForNewTurn();
      config.interactionLog.logPrompt(
        text, { source },
      );
    }
    return sent;
  }

  const line = config.dialect === "copilot"
    ? makeCopilotUserMessageLine(text)
    : makeUserMessageLine(text);
  try {
    child.stdin.write(line);
    resetForNewTurn();
    config.interactionLog.logPrompt(
      text, { source },
    );
    return true;
  } catch {
    return false;
  }
}

// ── AskUser auto-response ──────────────────────────────

export function autoAnswerAskUser(
  child: ChildProcess,
  obj: JsonObject,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  if (
    !config.capabilities.supportsAskUserAutoResponse
  ) {
    return;
  }
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
    const sent = doSendUserTurn(
      child, state, config,
      resp, "auto_ask_user_response",
    );
    if (sent) {
      config.pushEvent({
        type: "stdout",
        data: `\x1b[33m-> Auto-answered ` +
          `AskUserQuestion ` +
          `(${toolUseId.slice(0, 12)}...)` +
          `\x1b[0m\n`,
        timestamp: Date.now(),
      });
    } else {
      config.pushEvent({
        type: "stderr",
        data: "Failed to send auto-response " +
          "for AskUserQuestion.\n",
        timestamp: Date.now(),
      });
    }
  }
}

// ── Watchdog ───────────────────────────────────────────

export function doResetWatchdog(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  const ms = config.capabilities.watchdogTimeoutMs;
  if (ms == null) return;
  if (state.watchdogTimer) {
    clearTimeout(state.watchdogTimer);
  }
  state.watchdogTimer = setTimeout(() => {
    state.watchdogTimer = null;
    if (state.resultObserved) return;
    state.exitReason = "timeout";
    terminateProcessGroup(child);
  }, ms);
}
