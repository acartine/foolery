/**
 * Codex app-server JSON-RPC session client.
 *
 * Wraps the `codex app-server --listen stdio://` protocol
 * to provide multi-turn interactive sessions. Handles:
 *   1. Initialize + thread/start handshake
 *   2. Turn delivery via turn/start requests
 *   3. Turn interruption via turn/interrupt
 *   4. Translation of JSON-RPC notifications → flat
 *      JSONL events for the existing Codex normalizer
 */
import type { ChildProcess } from "node:child_process";
import type {
  PromptDispatchHooks,
} from "@/lib/session-prompt-delivery";

// ── Types ─────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  id: number;
  result: Record<string, unknown>;
}

interface JsonRpcNotification {
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcError {
  id: number;
  error: { code: number; message: string };
}

export interface CodexJsonRpcSession {
  readonly threadId: string | null;
  readonly ready: boolean;
  readonly turnId: string | null;
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
  threadId: string | null;
  ready: boolean;
  turnId: string | null;
  activeTurnRequestId: number | null;
  pendingTurn: {
    child: ChildProcess; prompt: string;
  } | null;
  hooks: PromptDispatchHooks;
}

// ── Constants ─────────────────────────────────────────

const INITIALIZE_ID = 1;
const THREAD_START_ID = 2;

const TRANSLATED_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
]);

// ── Low-level I/O ─────────────────────────────────────

function writeRequest(
  child: ChildProcess,
  req: JsonRpcRequest,
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
  msg: JsonRpcResponse,
  s: SessionState,
): void {
  if (msg.id === INITIALIZE_ID) return;
  if (msg.id === THREAD_START_ID) {
    const thread =
      msg.result.thread as
        Record<string, unknown> | undefined;
    if (
      thread && typeof thread.id === "string"
    ) {
      s.threadId = thread.id;
      s.ready = true;
      flushPendingTurn(s);
    }
    return;
  }
  if (
    msg.id === s.activeTurnRequestId &&
    msg.result
  ) {
    const turn =
      msg.result.turn as
        Record<string, unknown> | undefined;
    if (turn && typeof turn.id === "string") {
      s.turnId = turn.id;
    }
  }
}

function flushPendingTurn(s: SessionState): void {
  if (!s.pendingTurn || !s.threadId) return;
  const { child, prompt } = s.pendingTurn;
  s.pendingTurn = null;
  const id = s.nextId++;
  s.activeTurnRequestId = id;
  s.hooks.onAttempted?.();
  const sent = writeRequest(child, {
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: {
      threadId: s.threadId,
      input: [{ type: "text", text: prompt }],
    },
  });
  if (sent) {
    s.hooks.onSucceeded?.();
  } else {
    s.hooks.onFailed?.(
      "flush_pending_turn_write_failed",
    );
  }
}

function processSessionMessage(
  parsed: Record<string, unknown>,
  s: SessionState,
): Record<string, unknown> | null {
  if ("id" in parsed && "result" in parsed) {
    handleResponse(
      parsed as unknown as JsonRpcResponse,
      s,
    );
    return null;
  }
  if ("id" in parsed && "error" in parsed) {
    const msg = parsed as unknown as JsonRpcError;
    console.error(
      `[codex-jsonrpc] error id=${msg.id}: ` +
      msg.error.message,
    );
    return null;
  }
  if (
    "method" in parsed &&
    typeof parsed.method === "string"
  ) {
    return translateNotification(
      {
        method: parsed.method,
        params: (
          parsed.params as Record<string, unknown>
        ) ?? {},
      },
      s,
    );
  }
  return null;
}

function startTurnRequest(
  s: SessionState,
  child: ChildProcess,
  prompt: string,
): boolean {
  if (!s.ready || !s.threadId) {
    s.pendingTurn = { child, prompt };
    s.hooks.onDeferred?.("awaiting_thread_start");
    return true;
  }
  const id = s.nextId++;
  s.activeTurnRequestId = id;
  s.hooks.onAttempted?.();
  const sent = writeRequest(child, {
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: {
      threadId: s.threadId,
      input: [{ type: "text", text: prompt }],
    },
  });
  if (sent) {
    s.hooks.onSucceeded?.();
  } else {
    s.hooks.onFailed?.("turn_start_write_failed");
  }
  return sent;
}

// ── Item translation ──────────────────────────────────

function translateItemNotification(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const item =
    params.item as
      Record<string, unknown> | undefined;
  if (!item) return null;
  const eventType = method === "item/started"
    ? "item.started" : "item.completed";

  if (item.type === "commandExecution") {
    return translateCommandExecution(
      item, eventType,
    );
  }
  if (item.type === "agentMessage") {
    return translateAgentMessage(item, eventType);
  }
  if (item.type === "reasoning") {
    return translateReasoning(item, eventType);
  }
  return null;
}

function translateCommandExecution(
  item: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> {
  const command =
    typeof item.command === "string"
      ? item.command
      : typeof item.call === "object" &&
          item.call !== null
        ? (item.call as Record<string, unknown>)
            .command ?? ""
        : "";
  const output =
    typeof item.output === "string"
      ? item.output : "";
  return {
    type: eventType,
    item: {
      type: "command_execution",
      id: item.id,
      command,
      aggregated_output: output,
    },
  };
}

function translateAgentMessage(
  item: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> | null {
  if (eventType !== "item.completed") return null;
  const fragments =
    Array.isArray(item.fragments)
      ? item.fragments : [];
  const text = fragments
    .map((f: unknown) => {
      if (
        typeof f === "object" &&
        f !== null && "text" in f
      ) {
        return (f as Record<string, unknown>).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return {
    type: "item.completed",
    item: {
      type: "agent_message", id: item.id, text,
    },
  };
}

function translateReasoning(
  item: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> | null {
  if (eventType !== "item.completed") return null;
  const parts =
    Array.isArray(item.summaryParts)
      ? item.summaryParts : [];
  const text = parts
    .map((p: unknown) => {
      if (
        typeof p === "object" &&
        p !== null && "text" in p
      ) {
        return (p as Record<string, unknown>).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return {
    type: "item.completed",
    item: { type: "reasoning", text },
  };
}

// ── Notification translation ──────────────────────────

function translateNotification(
  msg: JsonRpcNotification,
  s: SessionState,
): Record<string, unknown> | null {
  const { method, params } = msg;
  if (!TRANSLATED_METHODS.has(method)) return null;

  if (method === "turn/started") {
    return { type: "turn.started" };
  }
  if (method === "turn/completed") {
    return translateTurnCompleted(params, s);
  }
  if (
    method === "item/started" ||
    method === "item/completed"
  ) {
    return translateItemNotification(
      method, params,
    );
  }
  if (method === "item/agentMessage/delta") {
    const text =
      typeof params.text === "string"
        ? params.text : "";
    return text
      ? {
          type: "item.delta",
          item: { type: "agent_message" },
          text,
        }
      : null;
  }
  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "item/reasoning/textDelta"
  ) {
    const text =
      typeof params.text === "string"
        ? params.text : "";
    return text
      ? {
          type: "item.completed",
          item: { type: "reasoning", text },
        }
      : null;
  }
  return null;
}

function translateTurnCompleted(
  params: Record<string, unknown>,
  s: SessionState,
): Record<string, unknown> {
  const turn =
    params.turn as
      Record<string, unknown> | undefined;
  if (turn?.status === "failed") {
    const error =
      turn.error as
        Record<string, unknown> | undefined;
    return {
      type: "turn.failed",
      error: {
        message:
          typeof error?.message === "string"
            ? error.message
            : "Turn failed",
      },
    };
  }
  s.turnId = null;
  return { type: "turn.completed" };
}

// ── Factory ───────────────────────────────────────────

export function createCodexJsonRpcSession(
  hooks: PromptDispatchHooks = {},
): CodexJsonRpcSession {
  const s: SessionState = {
    nextId: 3,
    threadId: null,
    ready: false,
    turnId: null,
    activeTurnRequestId: null,
    pendingTurn: null,
    hooks,
  };

  return {
    get threadId() { return s.threadId; },
    get ready() { return s.ready; },
    get turnId() { return s.turnId; },

    processLine(parsed) {
      return processSessionMessage(parsed, s);
    },

    sendHandshake(child) {
      writeRequest(child, {
        jsonrpc: "2.0",
        id: INITIALIZE_ID,
        method: "initialize",
        params: {
          clientInfo: {
            name: "foolery",
            version: "1.0.0",
          },
        },
      });
      writeRequest(child, {
        jsonrpc: "2.0",
        id: THREAD_START_ID,
        method: "thread/start",
        params: { approvalPolicy: "never" },
      });
    },

    startTurn(child, prompt) {
      return startTurnRequest(s, child, prompt);
    },

    interruptTurn(child) {
      if (!s.turnId || !s.threadId) return false;
      const id = s.nextId++;
      return writeRequest(child, {
        jsonrpc: "2.0",
        id,
        method: "turn/interrupt",
        params: {
          threadId: s.threadId,
          turnId: s.turnId,
        },
      });
    },
  };
}
