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
import {
  isTranslatedMethod,
  translateAgentMessageDelta,
  translateItemNotification,
  translateOutputDelta,
  translateReasoningDelta,
  translateTerminalInteraction,
  translateTurnCompleted,
} from "@/lib/codex-jsonrpc-translate";
import type {
  ApprovalAction,
  ApprovalReplyResult,
  ApprovalReplyTarget,
} from "@/lib/approval-actions";

// ── Types ─────────────────────────────────────────────

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResult {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
}

interface JsonRpcResponse {
  id: JsonRpcId;
  result: Record<string, unknown>;
}

interface JsonRpcNotification {
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcError {
  id: JsonRpcId;
  error: { code: number; message: string };
}

export type CodexApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never";

export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface CodexJsonRpcSessionOptions {
  approvalPolicy?: CodexApprovalPolicy;
  sandboxMode?: CodexSandboxMode;
}

export function codexApprovalPolicyForMode(
  mode: "bypass" | "prompt" | undefined,
): CodexApprovalPolicy {
  return mode === "prompt" ? "untrusted" : "never";
}

export function codexSessionOptionsForMode(
  mode: "bypass" | "prompt" | undefined,
): CodexJsonRpcSessionOptions {
  if (mode === "prompt") {
    return {
      approvalPolicy: "untrusted",
      sandboxMode: "read-only",
    };
  }
  return { approvalPolicy: "never" };
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
  respondToApproval(
    target: ApprovalReplyTarget,
    action: ApprovalAction,
  ): Promise<ApprovalReplyResult>;
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
  child: ChildProcess | null;
  approvalPolicy: CodexApprovalPolicy;
  sandboxMode: CodexSandboxMode | null;
  approvalRequestIds: Map<string, JsonRpcId>;
  approvalRequestMethods: Map<string, string>;
}

// ── Constants ─────────────────────────────────────────

const INITIALIZE_ID = 1;
const THREAD_START_ID = 2;

// ── Low-level I/O ─────────────────────────────────────

function writeJsonLine(
  child: ChildProcess,
  payload: JsonRpcRequest | JsonRpcResult,
): boolean {
  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded
  ) {
    return false;
  }
  try {
    child.stdin.write(JSON.stringify(payload) + "\n");
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
  s.child = child;
  const id = s.nextId++;
  s.activeTurnRequestId = id;
  s.hooks.onAttempted?.();
  const sent = writeJsonLine(child, {
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: {
      threadId: s.threadId,
      input: [{ type: "text", text: prompt }],
      approvalPolicy: s.approvalPolicy,
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
    recordApprovalRequestId(parsed, s);
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
  s.child = child;
  if (!s.ready || !s.threadId) {
    s.pendingTurn = { child, prompt };
    s.hooks.onDeferred?.("awaiting_thread_start");
    return true;
  }
  const id = s.nextId++;
  s.activeTurnRequestId = id;
  s.hooks.onAttempted?.();
  const sent = writeJsonLine(child, {
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: {
      threadId: s.threadId,
      input: [{ type: "text", text: prompt }],
      approvalPolicy: s.approvalPolicy,
    },
  });
  if (sent) {
    s.hooks.onSucceeded?.();
  } else {
    s.hooks.onFailed?.("turn_start_write_failed");
  }
  return sent;
}

function requestIdKey(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function recordApprovalRequestId(
  parsed: Record<string, unknown>,
  s: SessionState,
): void {
  if (!isApprovalRequestMethod(parsed.method)) {
    return;
  }
  const key = requestIdKey(parsed.id);
  if (!key) return;
  s.approvalRequestIds.set(
    key,
    parsed.id as JsonRpcId,
  );
  s.approvalRequestMethods.set(
    key,
    parsed.method as string,
  );
}

function isApprovalRequestMethod(value: unknown): boolean {
  return value === "mcpServer/elicitation/request" ||
    value === "item/commandExecution/requestApproval" ||
    value === "item/fileChange/requestApproval" ||
    value === "execCommandApproval" ||
    value === "applyPatchApproval";
}

function approvalResultForAction(
  action: ApprovalAction,
  method: string | undefined,
): Record<string, unknown> {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    if (action === "reject") return { decision: "decline" };
    if (action === "always_approve") {
      return { decision: "acceptForSession" };
    }
    return { decision: "accept" };
  }
  if (
    method === "execCommandApproval" ||
    method === "applyPatchApproval"
  ) {
    if (action === "reject") return { decision: "denied" };
    if (action === "always_approve") {
      return { decision: "approved_for_session" };
    }
    return { decision: "approved" };
  }
  if (action === "reject") {
    return { action: "decline" };
  }
  return { action: "accept", content: {} };
}

async function respondToCodexApproval(
  s: SessionState,
  target: ApprovalReplyTarget,
  action: ApprovalAction,
): Promise<ApprovalReplyResult> {
  if (!target.requestId) {
    return {
      ok: false,
      status: "unsupported",
      reason: "missing_request_id",
    };
  }
  if (!s.child) {
    return {
      ok: false,
      status: "reply_failed",
      reason: "missing_child_process",
    };
  }
  const id = s.approvalRequestIds.get(target.requestId)
    ?? target.requestId;
  const method = s.approvalRequestMethods.get(
    target.requestId,
  );
  const sent = writeJsonLine(s.child, {
    jsonrpc: "2.0",
    id,
    result: approvalResultForAction(action, method),
  });
  if (!sent) {
    return {
      ok: false,
      status: "reply_failed",
      reason: "approval_response_write_failed",
    };
  }
  return { ok: true };
}

// ── Notification translation ──────────────────────────

function translateNotification(
  msg: JsonRpcNotification,
  s: SessionState,
): Record<string, unknown> | null {
  const { method, params } = msg;
  if (!isTranslatedMethod(method)) return null;

  if (method === "turn/started") {
    return { type: "turn.started" };
  }
  if (method === "turn/completed") {
    const { event, turnFailed } =
      translateTurnCompleted(params);
    if (!turnFailed) s.turnId = null;
    return event;
  }
  if (
    method === "item/started" ||
    method === "item/completed"
  ) {
    return translateItemNotification(method, params);
  }
  if (method === "item/agentMessage/delta") {
    return translateAgentMessageDelta(params);
  }
  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "item/reasoning/textDelta"
  ) {
    return translateReasoningDelta(params);
  }
  if (method === "item/commandExecution/outputDelta") {
    return translateOutputDelta(params);
  }
  if (
    method ===
      "item/commandExecution/terminalInteraction"
  ) {
    return translateTerminalInteraction(params);
  }
  return null;
}

// ── Factory ───────────────────────────────────────────

export function createCodexJsonRpcSession(
  hooks: PromptDispatchHooks = {},
  options: CodexJsonRpcSessionOptions = {},
): CodexJsonRpcSession {
  const s: SessionState = {
    nextId: 3,
    threadId: null,
    ready: false,
    turnId: null,
    activeTurnRequestId: null,
    pendingTurn: null,
    hooks,
    child: null,
    approvalPolicy: options.approvalPolicy ?? "never",
    sandboxMode: options.sandboxMode ?? null,
    approvalRequestIds: new Map(),
    approvalRequestMethods: new Map(),
  };

  return {
    get threadId() { return s.threadId; },
    get ready() { return s.ready; },
    get turnId() { return s.turnId; },

    processLine(parsed) {
      return processSessionMessage(parsed, s);
    },

    sendHandshake(child) {
      s.child = child;
      writeJsonLine(child, {
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
      writeJsonLine(child, {
        jsonrpc: "2.0",
        id: THREAD_START_ID,
        method: "thread/start",
        params: {
          approvalPolicy: s.approvalPolicy,
          ...(s.sandboxMode
            ? { sandbox: s.sandboxMode }
            : {}),
        },
      });
    },

    startTurn(child, prompt) {
      return startTurnRequest(s, child, prompt);
    },

    interruptTurn(child) {
      if (!s.turnId || !s.threadId) return false;
      s.child = child;
      const id = s.nextId++;
      return writeJsonLine(child, {
        jsonrpc: "2.0",
        id,
        method: "turn/interrupt",
        params: {
          threadId: s.threadId,
          turnId: s.turnId,
        },
      });
    },

    respondToApproval(target, action) {
      return respondToCodexApproval(s, target, action);
    },
  };
}
