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
  formatStreamEvent,
  pushFormattedEvent,
} from "@/lib/terminal-manager-format";
import type {
  CodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";
import type {
  OpenCodeHttpSession,
} from "@/lib/opencode-http-session";
import type {
  GeminiAcpSession,
} from "@/lib/gemini-acp-session";
import {
  doCloseInput,
  doCancelInputClose,
  doScheduleInputClose,
  doSendUserTurn,
  autoAnswerAskUser,
  doResetWatchdog,
} from "@/lib/agent-session-runtime-helpers";

// ── Exit reason ────────────────────────────────────────

export type SessionExitReason =
  | "result_observed"
  | "timeout"
  | "spawn_error"
  | "external_abort"
  | "raw_close";

export type SessionRuntimeLifecycleEvent =
  | {
    type: "prompt_delivery_deferred";
    transport: "stdio" | "jsonrpc" | "http" | "acp";
    reason?: string;
  }
  | {
    type: "prompt_delivery_attempted";
    transport: "stdio" | "jsonrpc" | "http" | "acp";
  }
  | {
    type: "prompt_delivery_succeeded";
    transport: "stdio" | "jsonrpc" | "http" | "acp";
  }
  | {
    type: "prompt_delivery_failed";
    transport: "stdio" | "jsonrpc" | "http" | "acp";
    reason?: string;
  }
  | { type: "stdout_observed"; preview?: string }
  | { type: "stderr_observed"; preview?: string }
  | { type: "response_logged"; rawLine: string }
  | {
    type: "normalized_event_observed";
    eventType?: string;
    isError?: boolean;
  }
  | {
    type: "result_observed";
    eventType?: string;
    isError?: boolean;
  };

// ── Runtime configuration ──────────────────────────────

export interface SessionRuntimeConfig {
  id: string;
  dialect: AgentDialect;
  capabilities: AgentSessionCapabilities;
  watchdogTimeoutMs: number | null;
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
  onLifecycleEvent?: (
    event: SessionRuntimeLifecycleEvent,
  ) => void;
  /**
   * Optional Codex JSON-RPC session for
   * jsonrpc-stdio transport.
   */
  jsonrpcSession?: CodexJsonRpcSession;
  /**
   * Optional OpenCode HTTP session for
   * http-server transport.
   */
  httpSession?: OpenCodeHttpSession;
  /**
   * Optional Gemini ACP session for
   * acp-stdio transport.
   */
  acpSession?: GeminiAcpSession;
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
  /**
   * Inject a JSON line into the event processing
   * pipeline. Used by HTTP-based transports that
   * receive events outside of stdout.
   */
  injectLine(
    child: ChildProcess, line: string,
  ): void;
  dispose(): void;
}

// ── Event processing ───────────────────────────────────

function handleResultEvent(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  obj: Record<string, unknown>,
): void {
  state.resultObserved = true;
  state.exitReason = "result_observed";
  config.onLifecycleEvent?.({
    type: "result_observed",
    eventType: typeof obj.type === "string"
      ? obj.type
      : undefined,
    isError: obj.is_error === true,
  });
  const followUpSent =
    config.onResult?.() ?? false;
  if (!followUpSent) {
    doScheduleInputClose(child, state, config);
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
  config.onLifecycleEvent?.({
    type: "normalized_event_observed",
    eventType: typeof obj.type === "string"
      ? obj.type
      : undefined,
    isError: obj.is_error === true,
  });
  if (obj.type === "result") {
    handleResultEvent(child, state, config, obj);
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

    // JSON-RPC transport: translate first, then
    // normalize with the standard Codex normalizer
    if (config.jsonrpcSession) {
      const translated =
        config.jsonrpcSession.processLine(raw);
      if (!translated) return; // skip noise
      logTokenUsageForEvent(
        config.interactionLog,
        config.dialect,
        translated as JsonObject,
        config.beatIds,
      );
      const obj = (
        config.normalizeEvent(translated) ??
        translated
      ) as Record<string, unknown>;
      processNormalizedEvent(
        child, obj, state, config,
      );
      return;
    }

    // ACP transport: translate (needs child for
    // responding to client-side requests)
    if (config.acpSession) {
      const translated =
        config.acpSession.processLine(child, raw);
      if (!translated) return;
      logTokenUsageForEvent(
        config.interactionLog,
        config.dialect,
        translated as JsonObject,
        config.beatIds,
      );
      const obj = (
        config.normalizeEvent(translated) ??
        translated
      ) as Record<string, unknown>;
      processNormalizedEvent(
        child, obj, state, config,
      );
      return;
    }

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

// ── Wire helpers ──────────────────────────────────────

function doWireStdout(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  doResetWatchdog(child, state, config);
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    config.interactionLog.logStdout(text);
    config.onLifecycleEvent?.({
      type: "stdout_observed",
      preview: text.slice(0, 160),
    });

    // HTTP transport: stdout carries server logs,
    // not agent events. Pass lines to httpSession
    // for URL discovery; log the rest as stdout.
    if (config.httpSession) {
      const lines = text.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        if (
          !config.httpSession.processStdoutLine(line)
        ) {
          config.pushEvent({
            type: "stdout",
            data: line + "\n",
            timestamp: Date.now(),
          });
        }
      }
      return;
    }

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
      processLine(child, line, state, config);
    }
  });
}

function doFlushLineBuffer(
  child: ChildProcess,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  if (!state.lineBuffer.trim()) return;
  config.interactionLog.logResponse(
    state.lineBuffer,
  );
  config.onLifecycleEvent?.({
    type: "response_logged",
    rawLine: state.lineBuffer,
  });
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
    wireStdout: (child) =>
      doWireStdout(child, state, config),
    wireStderr: (child) => {
      child.stderr?.on(
        "data", (chunk: Buffer) => {
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
        },
      );
    },
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
      doFlushLineBuffer(child, state, config),
    injectLine: (child, line) =>
      processLine(child, line, state, config),
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
