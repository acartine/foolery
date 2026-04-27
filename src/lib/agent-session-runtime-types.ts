/**
 * Type-only definitions shared between
 * `agent-session-runtime.ts` and its sibling helper
 * files. Split out to avoid circular imports between
 * the runtime core and the event-processing pipeline.
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
import type { TerminalEvent } from "@/lib/types";
import type {
  JsonObject,
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

// ── Exit reason ────────────────────────────────────────

export type SessionExitReason =
  | "turn_ended"
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
    type: "turn_ended";
    eventType?: string;
    isError?: boolean;
  }
  | {
    type: "watchdog_fired";
    timeoutMs: number;
    msSinceLastEvent: number;
    lastEventType?: string;
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
   * Called when a turn has ended. Each transport
   * adapter decides when its protocol signals
   * end-of-turn and invokes `runtime.signalTurnEnded`
   * — this callback never inspects the payload shape.
   *
   * Return true (or a Promise resolving to true) if a
   * follow-up prompt was sent, which prevents stdin
   * close scheduling. Async callbacks let handlers
   * consult live state (e.g. a backend beat lookup in
   * the take-loop) before deciding whether to send a
   * follow-up. See foolery-6881.
   */
  onTurnEnded?: () => boolean | Promise<boolean>;
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
  watchdogArmedAt: number | null;
  autoAnsweredToolUseIds: Set<string>;
  resultObserved: boolean;
  exitReason: SessionExitReason | null;
  lastNormalizedEvent: JsonObject | null;
  /**
   * Wall-clock timestamp (ms since epoch) of the
   * most recent stdout chunk from the child. Null
   * until the first chunk arrives.
   */
  lastStdoutAt: number | null;
  /**
   * Last turn-failed signal from the transport
   * adapter (e.g. Codex `turn/completed` with
   * `status: "failed"` for `usageLimitExceeded`).
   * Set when a turn ends with `isError: true`;
   * cleared when a subsequent turn ends cleanly.
   * Read at child-close time so an iteration with a
   * failed turn but a clean process exit code is still
   * routed through the error path. Null until the
   * first failed turn is observed.
   */
  lastTurnError: { eventType?: string } | null;
}

/**
 * Optional informational fields carried alongside a
 * turn-ended signal. They populate the `turn_ended`
 * lifecycle event only — they are NOT gates.
 */
export interface TurnEndedInfo {
  eventType?: string;
  isError?: boolean;
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
  /**
   * Transport-neutral turn-ended dispatcher.
   * Each adapter (stdio/jsonrpc/acp/http) calls this
   * when it has observed the end of a turn in its
   * own protocol. The runtime does NOT inspect
   * payload shapes to make this decision — that
   * payload-dependent logic lives in the adapters.
   */
  signalTurnEnded(
    child: ChildProcess,
    info?: TurnEndedInfo,
  ): void;
  dispose(): void;
}
