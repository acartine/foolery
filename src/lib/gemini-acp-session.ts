/**
 * Gemini ACP (Agent Client Protocol) session client.
 *
 * Wraps `gemini --acp` stdio NDJSON protocol to provide
 * multi-turn interactive sessions. Handles:
 *   1. Initialize handshake (protocol version 1)
 *   2. Session creation via session/new
 *   3. Prompt delivery via session/prompt
 *   4. Turn cancellation via session/cancel
 *   5. Translation of ACP session/update notifications
 *      → flat JSONL events for the Gemini normalizer
 */
import type { ChildProcess } from "node:child_process";

// ── Types ─────────────────────────────────────────────

interface AcpRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface AcpResponse {
  id: number;
  result: Record<string, unknown>;
}

interface AcpNotification {
  method: string;
  params: Record<string, unknown>;
}

interface AcpError {
  id: number;
  error: { code: number; message: string };
}

export interface GeminiAcpSession {
  readonly sessionId: string | null;
  readonly ready: boolean;
  processLine(
    parsed: Record<string, unknown>,
  ): Record<string, unknown> | null;
  sendHandshake(child: ChildProcess): void;
  startTurn(
    child: ChildProcess, prompt: string,
  ): boolean;
  interruptTurn(child: ChildProcess): boolean;
}

// ── Internal state ────────────────────────────────────

interface SessionState {
  nextId: number;
  sessionId: string | null;
  ready: boolean;
  activePromptRequestId: number | null;
  pendingTurn: {
    child: ChildProcess; prompt: string;
  } | null;
}

// ── Constants ─────────────────────────────────────────

const INITIALIZE_ID = 1;
const SESSION_NEW_ID = 2;

// ── Low-level I/O ─────────────────────────────────────

function writeRequest(
  child: ChildProcess,
  req: AcpRequest,
): boolean {
  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded
  ) {
    return false;
  }
  try {
    child.stdin.write(JSON.stringify(req) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ── Response handling ─────────────────────────────────

function handleResponse(
  msg: AcpResponse,
  s: SessionState,
): void {
  if (msg.id === INITIALIZE_ID) return;
  if (msg.id === SESSION_NEW_ID) {
    const sid =
      typeof msg.result.sessionId === "string"
        ? msg.result.sessionId
        : null;
    if (sid) {
      s.sessionId = sid;
      s.ready = true;
      flushPendingTurn(s);
    }
    return;
  }
  // prompt response: turn completed
  if (msg.id === s.activePromptRequestId) {
    s.activePromptRequestId = null;
  }
}

function flushPendingTurn(s: SessionState): void {
  if (!s.pendingTurn || !s.sessionId) return;
  const { child, prompt } = s.pendingTurn;
  s.pendingTurn = null;
  const id = s.nextId++;
  s.activePromptRequestId = id;
  writeRequest(child, {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: s.sessionId,
      prompt: [{ type: "text", text: prompt }],
    },
  });
}

// ── Notification translation ──────────────────────────

function translateNotification(
  msg: AcpNotification,
): Record<string, unknown> | null {
  if (msg.method !== "session/update") return null;
  const params = msg.params;
  const update =
    params.update as
      Record<string, unknown> | undefined;
  if (!update) return null;
  const kind =
    typeof update.sessionUpdate === "string"
      ? update.sessionUpdate
      : null;
  if (!kind) return null;

  if (
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk"
  ) {
    return translateMessageChunk(update);
  }
  if (kind === "tool_call") {
    return translateToolCall(update);
  }
  if (kind === "tool_call_update") {
    return translateToolCallUpdate(update);
  }

  return null;
}

function translateMessageChunk(
  update: Record<string, unknown>,
): Record<string, unknown> | null {
  const content =
    update.content as
      Record<string, unknown> | undefined;
  if (!content) return null;
  const text =
    typeof content.text === "string"
      ? content.text
      : "";
  if (!text) return null;
  return {
    type: "message",
    role: "assistant",
    content: text,
    delta: true,
  };
}

function translateToolCall(
  update: Record<string, unknown>,
): Record<string, unknown> | null {
  const title =
    typeof update.title === "string"
      ? update.title
      : "";
  return {
    type: "message",
    role: "assistant",
    content: `[tool] ${title}`,
    delta: true,
  };
}

function translateToolCallUpdate(
  update: Record<string, unknown>,
): Record<string, unknown> | null {
  const status =
    typeof update.status === "string"
      ? update.status
      : null;
  if (status === "completed" || status === "failed") {
    const title =
      typeof update.title === "string"
        ? update.title
        : "";
    return {
      type: "message",
      role: "assistant",
      content: `[tool:${status}] ${title}`,
      delta: true,
    };
  }
  return null;
}

// ── Prompt response → result event ────────────────────

function translatePromptResponse(
  msg: AcpResponse,
): Record<string, unknown> {
  const stopReason =
    typeof msg.result.stopReason === "string"
      ? msg.result.stopReason
      : "end_turn";
  const isError =
    stopReason !== "end_turn" &&
    stopReason !== "cancelled";
  return {
    type: "result",
    status: isError ? "error" : "success",
  };
}

// ── Line processing ───────────────────────────────────

function doProcessLine(
  parsed: Record<string, unknown>,
  s: SessionState,
): Record<string, unknown> | null {
  if ("id" in parsed && "result" in parsed) {
    const msg = parsed as unknown as AcpResponse;
    if (msg.id === s.activePromptRequestId) {
      handleResponse(msg, s);
      return translatePromptResponse(msg);
    }
    handleResponse(msg, s);
    return null;
  }
  if ("id" in parsed && "error" in parsed) {
    const msg = parsed as unknown as AcpError;
    if (msg.id === s.activePromptRequestId) {
      s.activePromptRequestId = null;
      return {
        type: "result",
        status: "error",
        error: msg.error.message,
      };
    }
    console.error(
      `[gemini-acp] error id=${msg.id}` +
      `: ${msg.error.message}`,
    );
    return null;
  }
  if (
    "method" in parsed &&
    typeof parsed.method === "string"
  ) {
    return translateNotification({
      method: parsed.method,
      params: (
        parsed.params as
          Record<string, unknown>
      ) ?? {},
    });
  }
  return null;
}

// ── Factory ───────────────────────────────────────────

export function createGeminiAcpSession(
): GeminiAcpSession {
  const s: SessionState = {
    nextId: 3,
    sessionId: null,
    ready: false,
    activePromptRequestId: null,
    pendingTurn: null,
  };

  return {
    get sessionId() { return s.sessionId; },
    get ready() { return s.ready; },
    processLine: (parsed) =>
      doProcessLine(parsed, s),

    sendHandshake(child) {
      writeRequest(child, {
        jsonrpc: "2.0",
        id: INITIALIZE_ID,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: "foolery",
            version: "1.0.0",
          },
        },
      });
      writeRequest(child, {
        jsonrpc: "2.0",
        id: SESSION_NEW_ID,
        method: "session/new",
        params: {},
      });
    },

    startTurn(child, prompt) {
      if (!s.ready || !s.sessionId) {
        s.pendingTurn = { child, prompt };
        return true;
      }
      const id = s.nextId++;
      s.activePromptRequestId = id;
      return writeRequest(child, {
        jsonrpc: "2.0",
        id,
        method: "session/prompt",
        params: {
          sessionId: s.sessionId,
          prompt: [
            { type: "text", text: prompt },
          ],
        },
      });
    },

    interruptTurn(child) {
      if (!s.sessionId) return false;
      const id = s.nextId++;
      return writeRequest(child, {
        jsonrpc: "2.0",
        id,
        method: "session/cancel",
        params: { sessionId: s.sessionId },
      });
    },
  };
}
