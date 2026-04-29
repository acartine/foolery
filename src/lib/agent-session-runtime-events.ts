/**
 * Event processing pipeline for the agent session
 * runtime. Extracted from agent-session-runtime.ts to
 * keep that file under the 500-line ceiling.
 *
 * ── Transport-specific turn-ended triggers ──
 *
 * The critical insight of foolery-a401: the decision to
 * fire `onTurnEnded` is PER-TRANSPORT, not a generic
 * payload check. Each adapter names its own terminator:
 *
 *   - stdio (Claude, Copilot): `{type: "result"}`
 *   - jsonrpc (Codex):         `{type: "turn.completed"}`
 *   - acp (Gemini):            `{type: "result"}` from
 *                              the ACP translator
 *   - http (OpenCode):         injected `step_finish`
 *                              flows through the stdio
 *                              path (injected as JSON)
 *
 * The generic `processNormalizedEvent` in this file is
 * payload-agnostic — it does NOT call `signal` on its
 * own. Each transport wrapper below decides.
 *
 * DO NOT add `if (obj.type === ...) { signal() }` in
 * `processNormalizedEvent` or in the core runtime —
 * that is the fake-fix pattern this knot eradicates.
 */
import type { ChildProcess } from "node:child_process";
import { logTokenUsageForEvent } from "@/lib/agent-token-usage";
import {
  type JsonObject,
  formatStreamEvent,
  pushFormattedEvent,
} from "@/lib/terminal-manager-format";
import {
  extractApprovalRequest,
  formatApprovalRequestBanner,
  shouldEmitApprovalBannerFromRaw,
} from "@/lib/approval-request-visibility";
import type {
  SessionRuntimeState,
  SessionRuntimeConfig,
  TurnEndedInfo,
} from "@/lib/agent-session-runtime-types";
import {
  doCancelInputClose,
  autoAnswerAskUser,
  doResetWatchdog,
} from "@/lib/agent-session-runtime-helpers";

export type TurnEndedSignal = (
  child: ChildProcess,
  info?: TurnEndedInfo,
) => void;

export function processNormalizedEvent(
  child: ChildProcess,
  obj: Record<string, unknown>,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
  state.lastNormalizedEvent = obj;
  doResetWatchdog(child, state, config);
  config.onLifecycleEvent?.({
    type: "normalized_event_observed",
    eventType: typeof obj.type === "string"
      ? obj.type
      : undefined,
    isError: obj.is_error === true,
  });
  // Turn-ended detection moved to transport adapters.
  // stdio triggers from `processStdioLine` when the
  // raw normalized object has type "result"; jsonrpc
  // and acp trigger in `dispatchTranslated`.
  doCancelInputClose(state);
  const display = formatStreamEvent(obj);
  if (display) {
    pushFormattedEvent(display, config.pushEvent);
  }
  autoAnswerAskUser(child, obj, state, config);
}

export function processLine(
  child: ChildProcess,
  line: string,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  try {
    const raw = JSON.parse(line) as JsonObject;
    const approval = extractApprovalRequest(raw);
    if (approval) {
      config.onApprovalRequest?.(approval);
    }
    if (
      approval &&
      shouldEmitApprovalBannerFromRaw(raw)
    ) {
      config.pushEvent({
        type: "stderr",
        data: formatApprovalRequestBanner(
          approval,
          true,
        ),
        timestamp: Date.now(),
      });
    }
    if (dispatchTranslated(
      child, raw, state, config, signal,
    )) return;
    processStdioLine(
      child, raw, state, config, signal,
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

/**
 * Dispatch through the jsonrpc or acp translator.
 * Returns true when the line has been handled.
 *
 * Each adapter's turn-ended trigger is payload-gated
 * HERE — jsonrpc on `turn.completed` / `turn.failed`,
 * and acp on the translator-emitted `result`.
 */
function dispatchTranslated(
  child: ChildProcess,
  raw: JsonObject,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): boolean {
  if (config.jsonrpcSession) {
    handleJsonRpcLine(
      child, raw, state, config, signal,
    );
    return true;
  }
  if (config.acpSession) {
    handleAcpLine(
      child, raw, state, config, signal,
    );
    return true;
  }
  return false;
}

function handleJsonRpcLine(
  child: ChildProcess,
  raw: JsonObject,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  const t = config.jsonrpcSession!.processLine(raw);
  if (!t) return;
  runTranslatedPipeline(child, t, state, config);
  const type = typeof t.type === "string"
    ? t.type : undefined;
  if (type === "turn.completed") {
    signal(child, {
      eventType: type,
      isError: false,
    });
  } else if (type === "turn.failed") {
    signal(child, {
      eventType: type,
      isError: true,
    });
  }
}

function handleAcpLine(
  child: ChildProcess,
  raw: JsonObject,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  const t = config.acpSession!.processLine(child, raw);
  if (!t) return;
  runTranslatedPipeline(child, t, state, config);
  if (t.type === "result") {
    signal(child, {
      eventType: "result",
      isError: t.status === "error",
    });
  }
}

function runTranslatedPipeline(
  child: ChildProcess,
  translated: Record<string, unknown>,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
): void {
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
  processNormalizedEvent(child, obj, state, config);
}

/**
 * stdio transport (Claude stream-json, Copilot,
 * OpenCode injected HTTP parts). Triggers turn-ended
 * on `{type: "result"}` — the standard stdio
 * terminator across these dialects.
 *
 * The payload check lives HERE, in the stdio path,
 * NOT in the generic runtime core.
 */
function processStdioLine(
  child: ChildProcess,
  raw: JsonObject,
  state: SessionRuntimeState,
  config: SessionRuntimeConfig,
  signal: TurnEndedSignal,
): void {
  logTokenUsageForEvent(
    config.interactionLog,
    config.dialect,
    raw,
    config.beatIds,
  );
  const obj = (
    config.normalizeEvent(raw) ?? raw
  ) as Record<string, unknown>;
  processNormalizedEvent(child, obj, state, config);
  if (obj.type === "result") {
    signal(child, {
      eventType: "result",
      isError: obj.is_error === true,
    });
  }
}
