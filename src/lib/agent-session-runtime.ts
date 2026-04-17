/**
 * Shared agent session runtime.
 *
 * Centralizes line buffering, event normalization,
 * AskUser auto-response, stdin lifecycle, turn-ended
 * follow-up, watchdog, and process-group termination
 * so terminal-manager paths share one protocol.
 *
 * ── Turn-ended dispatch (foolery-a401) ──
 *
 * The generic runtime NEVER inspects payload shape to
 * decide when a turn has ended. Each transport adapter
 * (stdio, jsonrpc, acp, http) signals turn-end via
 * `runtime.signalTurnEnded()` using its own protocol
 * terminator. The runtime just routes the signal into
 * the optional `onTurnEnded` follow-up callback and
 * schedules stdin close when no follow-up was sent.
 *
 * DO NOT reintroduce `if (obj.type === "result") {
 * onTurnEnded() }` in this file. That bug, where the
 * payload gate lived in the transport-agnostic core,
 * silently disabled follow-up for Codex / Gemini /
 * OpenCode for months. See the knot handoff capsule
 * for the full story.
 */
import type { ChildProcess } from "node:child_process";
import {
  doCloseInput,
  doCancelInputClose,
  doScheduleInputClose,
  doSendUserTurn,
  doResetWatchdog,
} from "@/lib/agent-session-runtime-helpers";
import {
  processLine,
  type TurnEndedSignal,
} from "@/lib/agent-session-runtime-events";
import type {
  AgentSessionRuntime,
  SessionRuntimeConfig,
  SessionRuntimeState,
  TurnEndedInfo,
} from "@/lib/agent-session-runtime-types";

// Re-export type surface so existing call sites keep
// `from "@/lib/agent-session-runtime"` working after
// the split.
export type {
  AgentSessionRuntime,
  SessionExitReason,
  SessionRuntimeConfig,
  SessionRuntimeLifecycleEvent,
  SessionRuntimeState,
  TurnEndedInfo,
} from "@/lib/agent-session-runtime-types";

// ── Turn-ended handler ─────────────────────────────────

/**
 * Transport-neutral turn-ended handler. Invoked via
 * `runtime.signalTurnEnded` from each adapter when its
 * protocol reports end-of-turn. Does NOT inspect the
 * payload shape — the decision to call this function
 * has already been made by the caller.
 */
function handleTurnEnded(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  info: TurnEndedInfo,
): void {
  state.resultObserved = true;
  state.exitReason = "turn_ended";
  config.onLifecycleEvent?.({
    type: "turn_ended",
    eventType: info.eventType,
    isError: info.isError,
  });
  const result = config.onTurnEnded?.() ?? false;
  if (typeof result === "boolean") {
    if (!result) {
      doScheduleInputClose(child, state, config);
    }
    return;
  }
  // Async handler (foolery-6881): suppress immediate
  // grace-period close so the handler has time to
  // inspect live state and send a follow-up prompt. If
  // it resolves to false (no follow-up sent), schedule
  // the close then.
  result.then((followUpSent) => {
    if (!followUpSent) {
      doScheduleInputClose(child, state, config);
    }
  }).catch((err: unknown) => {
    console.error(
      `[terminal-manager] [${config.id}] ` +
      `onTurnEnded handler threw:`,
      err,
    );
    doScheduleInputClose(child, state, config);
  });
}

// ── Process termination (re-export) ────────────────────

export { terminateProcessGroup } from "@/lib/agent-session-process";

// ── Wire helpers ──────────────────────────────────────

function doWireStdout(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  doResetWatchdog(child, state, config);
  child.stdout?.on("data", (chunk: Buffer) => {
    state.lastStdoutAt = Date.now();
    const text = chunk.toString();
    config.interactionLog.logStdout(text);
    config.onLifecycleEvent?.({
      type: "stdout_observed",
      preview: text.slice(0, 160),
    });

    if (config.httpSession) {
      routeHttpStdout(text, config);
      return;
    }
    pumpLineBuffer(child, text, state, config, signal);
  });
}

function routeHttpStdout(
  text: string,
  config: SessionRuntimeConfig,
): void {
  // HTTP transport: stdout carries server logs,
  // not agent events. Pass lines to httpSession
  // for URL discovery; log the rest as stdout.
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!config.httpSession!.processStdoutLine(line)) {
      config.pushEvent({
        type: "stdout",
        data: line + "\n",
        timestamp: Date.now(),
      });
    }
  }
}

function pumpLineBuffer(
  child: ChildProcess,
  text: string,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  state.lineBuffer += text;
  const lines = state.lineBuffer.split("\n");
  state.lineBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    config.interactionLog.logResponse(line);
    config.onLifecycleEvent?.({
      type: "response_logged",
      rawLine: line,
    });
    processLine(child, line, state, config, signal);
  }
}

function doFlushLineBuffer(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  if (!state.lineBuffer.trim()) return;
  const line = state.lineBuffer;
  state.lineBuffer = "";
  config.interactionLog.logResponse(line);
  config.onLifecycleEvent?.({
    type: "response_logged",
    rawLine: line,
  });
  // Route through the full `processLine` pipeline so
  // the buffered line follows the same adapter-gated
  // turn-ended detection as streaming lines.
  processLine(child, line, state, config, signal);
}

// ── Factory ────────────────────────────────────────────

function initState(
  config: SessionRuntimeConfig,
): SessionRuntimeState {
  return {
    lineBuffer: "",
    stdinClosed: !config.capabilities.interactive,
    closeInputTimer: null,
    watchdogTimer: null,
    watchdogArmedAt: null,
    autoAnsweredToolUseIds: new Set(),
    resultObserved: false,
    exitReason: null,
    lastNormalizedEvent: null,
    lastStdoutAt: null,
  };
}

function wireStderrImpl(
  child: ChildProcess,
  config: SessionRuntimeConfig,
): void {
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    config.interactionLog.logStderr(text);
    config.onLifecycleEvent?.({
      type: "stderr_observed",
      preview: text.slice(0, 160),
    });
    console.log(
      `[terminal-manager] [${config.id}] ` +
      `stderr: ${text.slice(0, 200)}`,
    );
    config.pushEvent({
      type: "stderr", data: text,
      timestamp: Date.now(),
    });
  });
}

export function createSessionRuntime(
  config: SessionRuntimeConfig,
): AgentSessionRuntime {
  const state = initState(config);
  const signal: TurnEndedSignal = (child, info = {}) => {
    handleTurnEnded(child, state, config, info);
  };

  return {
    state,
    config,
    wireStdout: (child) =>
      doWireStdout(child, state, config, signal),
    wireStderr: (child) =>
      wireStderrImpl(child, config),
    sendUserTurn: (child, text, source) =>
      doSendUserTurn(
        child, state, config,
        text, source ?? "manual",
      ),
    closeInput: (child) =>
      doCloseInput(child, state, config),
    scheduleInputClose: (child) =>
      doScheduleInputClose(child, state, config),
    cancelInputClose: () =>
      doCancelInputClose(state),
    flushLineBuffer: (child) =>
      doFlushLineBuffer(child, state, config, signal),
    injectLine: (child, line) =>
      processLine(child, line, state, config, signal),
    signalTurnEnded: (child, info) =>
      signal(child, info),
    dispose: () => {
      doCancelInputClose(state);
      if (state.watchdogTimer) {
        clearTimeout(state.watchdogTimer);
        state.watchdogTimer = null;
      }
      state.stdinClosed = true;
    },
  };
}
