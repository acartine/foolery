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
} from "@/lib/agent-session-runtime-types";
import {
  terminateProcessGroup,
} from "@/lib/agent-session-process";

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

function resetForNewTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  state.resultObserved = false;
  state.exitReason = null;
  doResetWatchdog(child, state, config);
}

function failPromptDelivery(
  config: SessionRuntimeConfig,
  transport: "stdio" | "jsonrpc" | "http" | "acp",
  reason: string,
): false {
  config.onLifecycleEvent?.({
    type: "prompt_delivery_failed",
    transport,
    reason,
  });
  return false;
}

function sendHttpTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  text: string,
  source: string,
): boolean {
  if (state.stdinClosed) {
    return failPromptDelivery(
      config,
      "http",
      "stdin_closed",
    );
  }
  doCancelInputClose(state);
  const sent = config.httpSession?.startTurn(
    child,
    text,
  );
  if (sent) {
    resetForNewTurn(child, state, config);
    config.interactionLog.logPrompt(
      text,
      { source },
    );
  }
  return sent ?? false;
}

function sendSessionTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  text: string,
  source: string,
  transport: "jsonrpc" | "acp",
): boolean {
  const session = transport === "jsonrpc"
    ? config.jsonrpcSession
    : config.acpSession;
  const sent = session?.startTurn(child, text);
  if (sent) {
    resetForNewTurn(child, state, config);
    config.interactionLog.logPrompt(
      text,
      { source },
    );
  }
  return sent ?? false;
}

function sendStdioTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  text: string,
  source: string,
): boolean {
  const line = config.dialect === "copilot"
    ? makeCopilotUserMessageLine(text)
    : makeUserMessageLine(text);
  try {
    config.onLifecycleEvent?.({
      type: "prompt_delivery_attempted",
      transport: "stdio",
    });
    child.stdin!.write(line);
    resetForNewTurn(child, state, config);
    config.onLifecycleEvent?.({
      type: "prompt_delivery_succeeded",
      transport: "stdio",
    });
    config.interactionLog.logPrompt(
      text,
      { source },
    );
    return true;
  } catch {
    return failPromptDelivery(
      config,
      "stdio",
      "stdin_write_threw",
    );
  }
}

export function doSendUserTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  text: string,
  source: string,
): boolean {
  if (config.httpSession) {
    return sendHttpTurn(
      child, state, config, text, source,
    );
  }
  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded ||
    state.stdinClosed
  ) {
    const transport = config.jsonrpcSession
      ? "jsonrpc"
      : config.acpSession
        ? "acp"
        : "stdio";
    return failPromptDelivery(
      config,
      transport,
      "stdin_unavailable",
    );
  }
  doCancelInputClose(state);
  if (config.jsonrpcSession) {
    return sendSessionTurn(
      child, state, config, text, source,
      "jsonrpc",
    );
  }
  if (config.acpSession) {
    return sendSessionTurn(
      child, state, config, text, source, "acp",
    );
  }
  return sendStdioTurn(
    child, state, config, text, source,
  );
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

function fireWatchdogTimeout(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  ms: number,
): void {
  state.watchdogTimer = null;
  // Canonical liveness is still process liveness: if a
  // child stays open and silent, reap it. The exception is
  // OpenCode HTTP after a completed turn. Its server can
  // outlive `session.idle`, so cleanup reaping must not
  // rewrite the successful turn boundary as a timeout.
  const completedOpenCodeTurn =
    Boolean(config.httpSession) &&
    state.resultObserved &&
    state.exitReason === "turn_ended";
  if (!completedOpenCodeTurn) {
    state.exitReason = "timeout";
  }
  const armedAt = state.watchdogArmedAt;
  const msSinceLastEvent =
    armedAt != null ? Date.now() - armedAt : 0;
  const rawType = state.lastNormalizedEvent?.type;
  const lastEventType =
    typeof rawType === "string" ? rawType : undefined;
  console.warn(
    `[terminal-manager] [watchdog] timeout_fired ` +
    `pid=${child.pid ?? "unknown"} ` +
    `timeoutMs=${ms} ` +
    `msSinceLastEvent=${msSinceLastEvent} ` +
    `lastEventType=${lastEventType ?? "null"} ` +
    `reason=timeout`,
  );
  config.onLifecycleEvent?.({
    type: "watchdog_fired",
    timeoutMs: ms,
    msSinceLastEvent,
    lastEventType,
  });
  terminateProcessGroup(
    child,
    completedOpenCodeTurn
      ? "opencode_post_turn_cleanup_timeout"
      : "watchdog_timeout",
  );
}

export function doResetWatchdog(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  const ms = config.watchdogTimeoutMs;
  if (ms == null) return;
  if (config.httpSession && state.resultObserved) {
    return;
  }
  if (state.watchdogTimer) {
    clearTimeout(state.watchdogTimer);
  }
  state.watchdogArmedAt = Date.now();
  state.watchdogTimer = setTimeout(() => {
    fireWatchdogTimeout(child, state, config, ms);
  }, ms);
}
