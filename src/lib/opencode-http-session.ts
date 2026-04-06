/**
 * OpenCode HTTP session client.
 *
 * Wraps `opencode serve` to provide multi-turn
 * interactive sessions via the OpenCode HTTP API.
 * Handles:
 *   1. Server URL discovery from stdout
 *   2. Session creation via POST /session
 *   3. Turn delivery via POST /session/:id/message
 *   4. Translation of HTTP response parts → JSONL
 *      events for the existing OpenCode normalizer
 */
import type { ChildProcess } from "node:child_process";

// ── Types ─────────────────────────────────────────────

interface OpenCodePart {
  type: string;
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
}

// ── Internal state ────────────────────────────────────

interface SessionState {
  serverUrl: string | null;
  sessionId: string | null;
  ready: boolean;
  turnInFlight: boolean;
  pendingTurn: {
    child: ChildProcess; prompt: string;
  } | null;
}

// ── Constants ─────────────────────────────────────────

const SERVER_URL_PATTERN =
  /server listening on (https?:\/\/\S+)/;

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

// ── Part → JSONL translation ─────────────────────────

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

  // tool-use and tool-result parts can be
  // forwarded as-is; normalizer skips unknowns
  return null;
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
): Promise<void> {
  s.turnInFlight = true;
  try {
    const ok = await ensureSession(s, cb);
    if (!ok || !s.serverUrl || !s.sessionId) {
      cb.onError(
        "OpenCode HTTP session not ready " +
        "for turn delivery.",
      );
      emitErrorResult(cb);
      return;
    }
    const resp = await sendMessage(
      s.serverUrl, s.sessionId, prompt,
    );
    if (!resp || !resp.parts) {
      cb.onError(
        "OpenCode HTTP message request failed.",
      );
      emitErrorResult(cb);
      return;
    }
    for (const part of resp.parts) {
      const translated = translatePart(part);
      if (translated) {
        cb.onEvent(JSON.stringify(translated));
      }
    }
  } catch (err) {
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
): void {
  if (!s.pendingTurn || !s.ready) return;
  const { prompt } = s.pendingTurn;
  s.pendingTurn = null;
  void doTurn(s, cb, prompt);
}

// ── Factory ───────────────────────────────────────────

export function createOpenCodeHttpSession(
  onEvent: (jsonLine: string) => void,
  onError: (message: string) => void,
): OpenCodeHttpSession {
  const s: SessionState = {
    serverUrl: null,
    sessionId: null,
    ready: false,
    turnInFlight: false,
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
      flushPendingTurn(s, cb);
      return true;
    },

    startTurn(_, prompt) {
      if (!s.ready) {
        s.pendingTurn = { child: _, prompt };
        return true;
      }
      void doTurn(s, cb, prompt);
      return true;
    },

    interruptTurn() {
      s.pendingTurn = null;
      return true;
    },
  };
}
