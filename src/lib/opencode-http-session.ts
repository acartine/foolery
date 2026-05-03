import type { ChildProcess } from "node:child_process";
import type {
  PromptDispatchHooks,
} from "@/lib/session-prompt-delivery";
import {
  terminateProcessGroup,
} from "@/lib/agent-session-process";
import {
  respondToOpenCodeApproval,
} from "@/lib/opencode-approval-actions";
import type {
  ApprovalAction,
  ApprovalReplyResult,
  ApprovalReplyTarget,
} from "@/lib/approval-actions";
import { startOpenCodeEventStream } from "@/lib/opencode-event-stream";
import { parseOpenCodeModelSelection } from "@/lib/opencode-model-selection";
import {
  hasOpenCodeMessagePayload,
  translateOpenCodeEvent,
  translateOpenCodeResponse,
  type OpenCodeMessageResponse,
} from "@/lib/opencode-event-translate";

interface SessionCreateResponse {
  id: string;
  slug?: string;
}

export interface OpenCodeHttpSession {
  readonly serverUrl: string | null;
  readonly sessionId: string | null;
  readonly ready: boolean;
  processStdoutLine(line: string): boolean;
  startTurn(
    child: ChildProcess, prompt: string,
  ): boolean;
  interruptTurn(child: ChildProcess): boolean;
  respondToApproval(
    target: ApprovalReplyTarget,
    action: ApprovalAction,
  ): Promise<ApprovalReplyResult>;
}

export interface OpenCodeHttpSessionOptions {
  model?: string;
}

interface SessionState {
  serverUrl: string | null;
  sessionId: string | null;
  ready: boolean;
  turnInFlight: boolean;
  turnActivityObserved: boolean;
  turnId: number;
  model?: string;
  eventStreamAbort: AbortController | null;
  shutdownInFlight: Promise<void> | null;
  pendingTurn: {
    child: ChildProcess; prompt: string;
  } | null;
  emittedToolUseIds: Set<string>;
  emittedToolResultIds: Set<string>;
}

const SERVER_URL_PATTERN =
  /server listening on (https?:\/\/\S+)/;
const CONTROL_REQUEST_TIMEOUT_MS = 1_500;
const MESSAGE_REQUEST_RETRY_BACKOFF_MS = [
  8_000, 16_000, 32_000,
] as const;
const MESSAGE_REQUEST_MAX_ATTEMPTS =
  MESSAGE_REQUEST_RETRY_BACKOFF_MS.length + 1;

async function createSession(
  baseUrl: string,
): Promise<string | null> {
  try {
    const resp = await fetch(
      `${baseUrl}/session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "foolery-interactive",
        }),
      },
    );
    if (!resp.ok) return null;
    const data =
      await resp.json() as SessionCreateResponse;
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function sendMessage(
  baseUrl: string,
  sessionId: string,
  prompt: string,
  model?: string,
): Promise<OpenCodeMessageResponse | null> {
  const modelSelection =
    parseOpenCodeModelSelection(model);
  try {
    const resp = await fetch(
      `${baseUrl}/session/${sessionId}/message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(modelSelection
            ? { model: modelSelection }
            : {}),
          parts: [{ type: "text", text: prompt }],
        }),
      },
    );
    if (!resp.ok) return null;
    return await resp.json() as
      OpenCodeMessageResponse;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sendMessageWithRetry(
  s: SessionState,
  cb: SessionCallbacks,
  prompt: string,
  turnId: number,
): Promise<OpenCodeMessageResponse | null> {
  let resp: OpenCodeMessageResponse | null = null;
  for (
    let attempt = 0;
    attempt < MESSAGE_REQUEST_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (s.turnId !== turnId) return null;
    resp = await sendMessage(
      s.serverUrl!, s.sessionId!, prompt, s.model,
    );
    if (resp && hasOpenCodeMessagePayload(resp)) return resp;
    if (s.turnActivityObserved) return resp;
    const delay = MESSAGE_REQUEST_RETRY_BACKOFF_MS[attempt];
    if (delay === undefined) break;
    cb.onError(
      "OpenCode HTTP message request failed; retrying " +
      `in ${delay / 1_000}s ` +
      `(${attempt + 2}/${MESSAGE_REQUEST_MAX_ATTEMPTS}).`,
    );
    await sleep(delay);
    if (s.turnId !== turnId) return null;
  }
  return resp;
}

async function postControlRequest(
  baseUrl: string,
  path: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CONTROL_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${baseUrl}${path}`,
      {
        method: "POST",
        signal: controller.signal,
      },
    );
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

interface SessionCallbacks {
  onEvent: (jsonLine: string) => void;
  onError: (message: string) => void;
}

/**
 * Filter translated events to dedupe streaming
 * tool_use / tool_result emissions. The same OpenCode
 * tool part can arrive several times (pending → running
 * → completed); we want exactly one tool_use line per
 * call id, plus exactly one tool_result line once the
 * call has terminal output.
 *
 * For tool_use we wait for the first event whose `input`
 * is populated. The pending part arrives before the model
 * commits the tool input, so its translated `input` is
 * `{}`. Emitting that one would freeze the rendered
 * "▶ tool" line with no args because the populated
 * running/completed update is then deduped.
 */
function dedupeStreamedEvent(
  s: SessionState,
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = event.type;
  if (type === "tool_use") {
    const id = typeof event.id === "string" ? event.id : "";
    if (id) {
      if (s.emittedToolUseIds.has(id)) return null;
      const input = event.input;
      const hasInput =
        !!input
        && typeof input === "object"
        && Object.keys(input as Record<string, unknown>).length > 0;
      if (!hasInput) return null;
      s.emittedToolUseIds.add(id);
    }
    return event;
  }
  if (type === "tool_result") {
    const id = typeof event.tool_use_id === "string"
      ? event.tool_use_id
      : "";
    if (id) {
      if (s.emittedToolResultIds.has(id)) return null;
      s.emittedToolResultIds.add(id);
    }
    return event;
  }
  return event;
}

function emitTranslated(
  s: SessionState,
  cb: SessionCallbacks,
  events: Array<Record<string, unknown>>,
): void {
  const wasTurnInFlight = s.turnInFlight;
  let emitted = false;
  for (const event of events) {
    if (
      event.type === "session_idle" ||
      event.type === "session_error"
    ) {
      s.turnInFlight = false;
    }
    const filtered = dedupeStreamedEvent(s, event);
    if (filtered) {
      emitted = true;
      cb.onEvent(JSON.stringify(filtered));
    }
  }
  if (wasTurnInFlight && emitted) {
    s.turnActivityObserved = true;
  }
}

async function ensureSession(
  s: SessionState,
  cb: SessionCallbacks,
): Promise<boolean> {
  if (s.sessionId) return true;
  if (!s.serverUrl) return false;
  const id = await createSession(s.serverUrl);
  if (!id) {
    cb.onError(
      "Failed to create OpenCode session " +
      `via ${s.serverUrl}/session`,
    );
    return false;
  }
  s.sessionId = id;
  return true;
}

function emitErrorResult(
  cb: SessionCallbacks,
): void {
  cb.onEvent(JSON.stringify({
    type: "step_finish",
    part: { reason: "error" },
  }));
}

function startEventStream(
  s: SessionState,
  cb: SessionCallbacks,
): void {
  if (!s.serverUrl || s.eventStreamAbort) return;
  s.eventStreamAbort = startOpenCodeEventStream(
    s.serverUrl,
    (value) => {
      emitTranslated(s, cb, translateOpenCodeEvent(value));
    },
    cb.onError,
  );
}

async function doTurn(
  s: SessionState,
  cb: SessionCallbacks,
  prompt: string,
  hooks: PromptDispatchHooks,
): Promise<void> {
  s.turnInFlight = true;
  const turnId = s.turnId + 1;
  s.turnId = turnId;
  hooks.onAttempted?.();
  try {
    const ok = await ensureSession(s, cb);
    if (!ok || !s.serverUrl || !s.sessionId) {
      hooks.onFailed?.(
        "http_session_not_ready",
      );
      cb.onError(
        "OpenCode HTTP session not ready " +
        "for turn delivery.",
      );
      emitErrorResult(cb);
      return;
    }
    startEventStream(s, cb);
    s.turnActivityObserved = false;
    const resp = await sendMessageWithRetry(
      s, cb, prompt, turnId,
    );
    if (s.turnId !== turnId) return;
    if (!resp || !hasOpenCodeMessagePayload(resp)) {
      // foolery-70fb: do NOT synthesize a fake
      // {type:"result", is_error:true} here. The SSE
      // /event stream (started above) is the canonical
      // turn-end signal — it delivers session.idle when
      // the agent actually finishes. undici's default
      // headersTimeout (300s) routinely fires while
      // long agent turns are still running, and
      // emitting an error result here triggers a
      // spurious take-loop "advance or rollback"
      // follow-up while the real turn is still in
      // flight. Log and let SSE drive the boundary.
      hooks.onFailed?.("http_message_request_failed");
      cb.onError(
        "OpenCode HTTP message request failed " +
        "(POST timed out or non-2xx). Waiting for " +
        "session.idle from SSE stream.",
      );
      return;
    }
    hooks.onSucceeded?.();
    emitTranslated(s, cb, translateOpenCodeResponse(resp));
  } catch (err) {
    hooks.onFailed?.("http_turn_threw");
    const msg = err instanceof Error
      ? err.message : "Unknown error";
    cb.onError(
      `OpenCode HTTP turn error: ${msg}`,
    );
    emitErrorResult(cb);
  } finally {
    s.turnInFlight = false;
  }
}

function flushPendingTurn(
  s: SessionState,
  cb: SessionCallbacks,
  hooks: PromptDispatchHooks,
): void {
  if (!s.pendingTurn || !s.ready) return;
  const { prompt } = s.pendingTurn;
  s.pendingTurn = null;
  void doTurn(s, cb, prompt, hooks);
}

async function disposeServer(
  s: SessionState,
  child: ChildProcess,
): Promise<void> {
  s.eventStreamAbort?.abort();
  s.eventStreamAbort = null;
  const baseUrl = s.serverUrl;
  if (!baseUrl) {
    terminateProcessGroup(
      child,
      "opencode_interrupt_before_ready",
    );
    return;
  }

  if (s.turnInFlight && s.sessionId) {
    await postControlRequest(
      baseUrl,
      `/session/${s.sessionId}/abort`,
    );
  }

  const disposed = await postControlRequest(
    baseUrl,
    "/instance/dispose",
  );
  if (disposed) {
    terminateProcessGroup(
      child,
      "opencode_dispose_completed",
    );
    return;
  }

  terminateProcessGroup(
    child,
    "opencode_interrupt_dispose_failed",
  );
}

export function createOpenCodeHttpSession(
  onEvent: (jsonLine: string) => void,
  onError: (message: string) => void,
  hooks: PromptDispatchHooks = {},
  options: OpenCodeHttpSessionOptions = {},
): OpenCodeHttpSession {
  const s: SessionState = {
    serverUrl: null,
    sessionId: null,
    ready: false,
    turnInFlight: false,
    turnActivityObserved: false,
    turnId: 0,
    model: options.model,
    eventStreamAbort: null,
    shutdownInFlight: null,
    pendingTurn: null,
    emittedToolUseIds: new Set<string>(),
    emittedToolResultIds: new Set<string>(),
  };
  const cb: SessionCallbacks = {
    onEvent, onError,
  };

  return {
    get serverUrl() { return s.serverUrl; },
    get sessionId() { return s.sessionId; },
    get ready() { return s.ready; },

    processStdoutLine(line) {
      const match = SERVER_URL_PATTERN.exec(line);
      if (!match) return false;
      s.serverUrl = match[1];
      s.ready = true;
      flushPendingTurn(s, cb, hooks);
      return true;
    },

    startTurn(_, prompt) {
      if (!s.ready) {
        s.pendingTurn = { child: _, prompt };
        hooks.onDeferred?.("awaiting_server_url");
        return true;
      }
      void doTurn(s, cb, prompt, hooks);
      return true;
    },

    interruptTurn(child) {
      s.pendingTurn = null;
      s.turnId += 1;
      if (s.shutdownInFlight) return true;
      s.shutdownInFlight = disposeServer(
        s,
        child,
      ).finally(() => {
        s.shutdownInFlight = null;
      });
      return true;
    },

    respondToApproval(target, action) {
      return respondToOpenCodeApproval({
        baseUrl: s.serverUrl,
        nativeSessionId:
          target.nativeSessionId ?? s.sessionId,
        permissionId:
          target.permissionId ?? target.requestId,
        action,
      });
    },
  };
}
