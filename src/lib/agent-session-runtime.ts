/**
 * Shared agent session runtime.
 *
 * Centralizes line buffering, event normalization,
 * AskUser auto-response, stdin lifecycle, result
 * follow-up, watchdog, and process-group termination
 * so terminal-manager paths share one protocol.
 */
import type { ChildProcess } from "node:child_process";
import type { InteractionLog } from "@/lib/interaction-logger";
import type {
  AgentDialect,
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type {
  AgentSessionCapabilities,
} from "@/lib/agent-session-capabilities";
import { logTokenUsageForEvent } from "@/lib/agent-token-usage";
import type { TerminalEvent } from "@/lib/types";
import {
  type JsonObject,
  toObject,
  buildAutoAskUserResponse,
  makeUserMessageLine,
  formatStreamEvent,
  pushFormattedEvent,
} from "@/lib/terminal-manager-format";
import {
  INPUT_CLOSE_GRACE_MS,
} from "@/lib/terminal-manager-types";

// ── Exit reason ────────────────────────────────────────

export type SessionExitReason =
  | "result_observed"
  | "timeout"
  | "spawn_error"
  | "external_abort"
  | "raw_close";

// ── Runtime configuration ──────────────────────────────

export interface SessionRuntimeConfig {
  id: string;
  dialect: AgentDialect;
  capabilities: AgentSessionCapabilities;
  normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >;
  pushEvent: (evt: TerminalEvent) => void;
  interactionLog: InteractionLog;
  beatIds: string[];
  /**
   * Called when a result event is observed.
   * Return true if a follow-up prompt was sent,
   * which prevents stdin close scheduling.
   */
  onResult?: () => boolean;
}

// ── Runtime state ──────────────────────────────────────

export interface SessionRuntimeState {
  lineBuffer: string;
  stdinClosed: boolean;
  closeInputTimer: NodeJS.Timeout | null;
  watchdogTimer: NodeJS.Timeout | null;
  autoAnsweredToolUseIds: Set<string>;
  resultObserved: boolean;
  exitReason: SessionExitReason | null;
  lastNormalizedEvent: JsonObject | null;
}

// ── Runtime handle ─────────────────────────────────────

export interface AgentSessionRuntime {
  readonly state: SessionRuntimeState;
  readonly config: SessionRuntimeConfig;
  wireStdout(child: ChildProcess): void;
  wireStderr(child: ChildProcess): void;
  sendUserTurn(
    child: ChildProcess,
    text: string,
    source?: string,
  ): boolean;
  closeInput(child: ChildProcess): void;
  scheduleInputClose(child: ChildProcess): void;
  cancelInputClose(): void;
  flushLineBuffer(child: ChildProcess): void;
  dispose(): void;
}

// ── Stdin operations ───────────────────────────────────

function doCloseInput(
  child: ChildProcess,
  state: SessionRuntimeState,
  cancelFn: () => void,
): void {
  if (state.stdinClosed) return;
  cancelFn();
  state.stdinClosed = true;
  child.stdin?.end();
}

function doCancelInputClose(
  state: SessionRuntimeState,
): void {
  if (!state.closeInputTimer) return;
  clearTimeout(state.closeInputTimer);
  state.closeInputTimer = null;
}

function doScheduleInputClose(
  child: ChildProcess,
  state: SessionRuntimeState,
): void {
  doCancelInputClose(state);
  state.closeInputTimer = setTimeout(
    () => doCloseInput(
      child, state, () => doCancelInputClose(state),
    ),
    INPUT_CLOSE_GRACE_MS,
  );
}

function doSendUserTurn(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  text: string,
  source: string,
): boolean {
  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded ||
    state.stdinClosed
  ) {
    return false;
  }
  doCancelInputClose(state);
  const line = makeUserMessageLine(text);
  try {
    child.stdin.write(line);
    config.interactionLog.logPrompt(
      text, { source },
    );
    return true;
  } catch {
    return false;
  }
}

// ── AskUser auto-response ──────────────────────────────

function autoAnswerAskUser(
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

function doResetWatchdog(
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

// ── Event processing ───────────────────────────────────

function handleResultEvent(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  state.resultObserved = true;
  state.exitReason = "result_observed";
  const followUpSent =
    config.onResult?.() ?? false;
  if (!followUpSent) {
    doScheduleInputClose(child, state);
  }
}

function processNormalizedEvent(
  child: ChildProcess,
  obj: Record<string, unknown>,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  state.lastNormalizedEvent = obj;
  doResetWatchdog(child, state, config);
  autoAnswerAskUser(child, obj, state, config);
  if (obj.type === "result") {
    handleResultEvent(child, state, config);
  } else {
    doCancelInputClose(state);
  }
  const display = formatStreamEvent(obj);
  if (display) {
    pushFormattedEvent(display, config.pushEvent);
  }
}

function processLine(
  child: ChildProcess,
  line: string,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  try {
    const raw = JSON.parse(line) as JsonObject;
    logTokenUsageForEvent(
      config.interactionLog,
      config.dialect,
      raw,
      config.beatIds,
    );
    const obj = (
      config.normalizeEvent(raw) ?? raw
    ) as Record<string, unknown>;
    processNormalizedEvent(
      child, obj, state, config,
    );
  } catch {
    console.log(
      `[terminal-manager] [${config.id}] ` +
      `raw stdout: ${line.slice(0, 150)}`,
    );
    config.pushEvent({
      type: "stdout",
      data: line + "\n",
      timestamp: Date.now(),
    });
  }
}

// ── Process termination ────────────────────────────────

export function terminateProcessGroup(
  child: ChildProcess,
  delayMs = 5000,
): void {
  const pid = child.pid;
  try {
    if (pid) process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch { /* already dead */ }
  }
  setTimeout(() => {
    try {
      if (pid) process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch { /* already dead */ }
    }
  }, delayMs);
}

// ── Factory ────────────────────────────────────────────

export function createSessionRuntime(
  config: SessionRuntimeConfig,
): AgentSessionRuntime {
  const state: SessionRuntimeState = {
    lineBuffer: "",
    stdinClosed: !config.capabilities.interactive,
    closeInputTimer: null,
    watchdogTimer: null,
    autoAnsweredToolUseIds: new Set(),
    resultObserved: false,
    exitReason: null,
    lastNormalizedEvent: null,
  };

  return {
    state,
    config,
    wireStdout: (child) => {
      doResetWatchdog(child, state, config);
      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        config.interactionLog.logStdout(text);
        state.lineBuffer += text;
        const lines =
          state.lineBuffer.split("\n");
        state.lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          config.interactionLog.logResponse(line);
          processLine(
            child, line, state, config,
          );
        }
      });
    },
    wireStderr: (child) => {
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        config.interactionLog.logStderr(text);
        console.log(
          `[terminal-manager] [${config.id}] ` +
          `stderr: ${text.slice(0, 200)}`,
        );
        config.pushEvent({
          type: "stderr", data: text,
          timestamp: Date.now(),
        });
      });
    },
    sendUserTurn: (child, text, source) =>
      doSendUserTurn(
        child, state, config,
        text, source ?? "manual",
      ),
    closeInput: (child) =>
      doCloseInput(
        child, state,
        () => doCancelInputClose(state),
      ),
    scheduleInputClose: (child) =>
      doScheduleInputClose(child, state),
    cancelInputClose: () =>
      doCancelInputClose(state),
    flushLineBuffer: (child) => {
      if (!state.lineBuffer.trim()) return;
      config.interactionLog.logResponse(
        state.lineBuffer,
      );
      try {
        const obj = JSON.parse(
          state.lineBuffer,
        ) as JsonObject;
        logTokenUsageForEvent(
          config.interactionLog,
          config.dialect,
          obj,
          config.beatIds,
        );
        processNormalizedEvent(
          child, obj, state, config,
        );
      } catch {
        config.pushEvent({
          type: "stdout",
          data: state.lineBuffer + "\n",
          timestamp: Date.now(),
        });
      }
      state.lineBuffer = "";
    },
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
