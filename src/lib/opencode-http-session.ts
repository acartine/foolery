/**
 * OpenCode HTTP session client.
 *
 * Wraps `opencode serve` to provide multi-turn
 * interactive sessions via the OpenCode HTTP API.
 */
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

// ── Types ─────────────────────────────────────────────

interface OpenCodePart {
  type: string;
  [key: string]: unknown;
  text?: string;
  reason?: string;
  snapshot?: string;
  tokens?: Record<string, unknown>;
  cost?: number;
  id?: string;
  sessionID?: string;
  messageID?: string;
  time?: Record<string, unknown>;
}

interface OpenCodeMessageResponse {
  info?: Record<string, unknown>;
  parts?: OpenCodePart[];
  events?: unknown[];
  stream?: unknown[];
  items?: unknown[];
}

interface SessionCreateResponse {
  id: string;
  slug?: string;
}

export interface OpenCodeHttpSession {
  readonly serverUrl: string | null;
  readonly sessionId: string | null;
  readonly ready: boolean;
  /**
   * Parse a stdout line for server URL.
   * Returns true if the line was the URL announcement.
   */
  processStdoutLine(line: string): boolean;
  /**
   * Send a turn via HTTP. Events are injected into
   * the runtime via the onEvent callback.
   * Returns true if the turn was initiated.
   */
  startTurn(
    child: ChildProcess, prompt: string,
  ): boolean;
  /**
   * Interrupt the current session by killing the
   * server process.
   */
  interruptTurn(child: ChildProcess): boolean;
  respondToApproval(
    target: ApprovalReplyTarget,
    action: ApprovalAction,
  ): Promise<ApprovalReplyResult>;
}

export interface OpenCodeHttpSessionOptions {
  model?: string;
}

// ── Internal state ────────────────────────────────────

interface SessionState {
  serverUrl: string | null;
  sessionId: string | null;
  ready: boolean;
  turnInFlight: boolean;
  model?: string;
  shutdownInFlight: Promise<void> | null;
  pendingTurn: {
    child: ChildProcess; prompt: string;
  } | null;
}

// ── Constants ─────────────────────────────────────────

const SERVER_URL_PATTERN =
  /server listening on (https?:\/\/\S+)/;
const CONTROL_REQUEST_TIMEOUT_MS = 1_500;

// ── HTTP helpers ──────────────────────────────────────

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
  try {
    const resp = await fetch(
      `${baseUrl}/session/${sessionId}/message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(model ? { model } : {}),
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

// ── Part → JSONL translation ─────────────────────────

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(
  value: unknown,
): string | null {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function translateEvent(
  value: unknown,
): Record<string, unknown> | null {
  const event = toObject(value);
  if (!event) return null;
  const type = asString(event.type);
  if (
    type === "permission.asked" ||
    type === "permission.updated"
  ) return event;
  const name = asString(event.event)
    ?? asString(event.name);
  if (
    name === "permission.asked" ||
    name === "permission.updated"
  ) {
    return { ...event, type: name };
  }
  const part = toObject(event.part);
  const partType = asString(part?.type)
    ?? asString(part?.event)
    ?? asString(part?.name);
  return (
    partType === "permission.asked" ||
    partType === "permission.updated"
  )
    ? { ...event, type: partType }
    : null;
}

/**
 * Translate an HTTP response part into the JSONL
 * format that `opencode run --format json` emits,
 * so the existing OpenCode normalizer can process it.
 */
function translatePart(
  part: OpenCodePart,
): Record<string, unknown> | null {
  const type = part.type;

  if (type === "step-start") {
    return { type: "step_start" };
  }

  if (type === "text") {
    return {
      type: "text",
      part: { text: part.text ?? "" },
    };
  }

  if (type === "step-finish") {
    return {
      type: "step_finish",
      part: { reason: part.reason ?? "stop" },
    };
  }

  const event = translateEvent(part);
  if (event) return event;

  // tool-use and tool-result parts can be
  // forwarded as-is; normalizer skips unknowns
  return null;
}

function eventCollections(
  resp: OpenCodeMessageResponse,
): unknown[][] {
  return [
    resp.events,
    resp.stream,
    resp.items,
  ].filter((value): value is unknown[] =>
    Array.isArray(value));
}

function hasMessagePayload(
  resp: OpenCodeMessageResponse,
): boolean {
  return Array.isArray(resp.parts)
    || eventCollections(resp).length > 0
    || translateEvent(resp) !== null;
}

function translateResponse(
  resp: OpenCodeMessageResponse,
): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const part of resp.parts ?? []) {
    const translated = translatePart(part);
    if (translated) events.push(translated);
  }
  for (const collection of eventCollections(resp)) {
    for (const event of collection) {
      const translated = translateEvent(event);
      if (translated) events.push(translated);
    }
  }
  const direct = translateEvent(resp);
  if (direct) events.push(direct);
  return events;
}

// ── Session lifecycle helpers ─────────────────────────

interface SessionCallbacks {
  onEvent: (jsonLine: string) => void;
  onError: (message: string) => void;
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

async function doTurn(
  s: SessionState,
  cb: SessionCallbacks,
  prompt: string,
  hooks: PromptDispatchHooks,
): Promise<void> {
  s.turnInFlight = true;
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
    const resp = await sendMessage(
      s.serverUrl, s.sessionId, prompt, s.model,
    );
    if (!resp || !hasMessagePayload(resp)) {
      hooks.onFailed?.("http_message_request_failed");
      cb.onError(
        "OpenCode HTTP message request failed.",
      );
      emitErrorResult(cb);
      return;
    }
    hooks.onSucceeded?.();
    for (const event of translateResponse(resp)) {
      cb.onEvent(JSON.stringify(event));
    }
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
  if (disposed) return;

  terminateProcessGroup(
    child,
    "opencode_interrupt_dispose_failed",
  );
}

// ── Factory ───────────────────────────────────────────

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
    model: options.model,
    shutdownInFlight: null,
    pendingTurn: null,
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
