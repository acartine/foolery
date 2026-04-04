/**
 * Gemini ACP (Agent Client Protocol) session over
 * JSON-RPC stdio.
 *
 * Protocol flow:
 *   1. initialize → agent capabilities
 *   2. session/new → sessionId
 *   3. session/prompt → updates + stopReason
 *   4. session/cancel → abort current turn
 *
 * ACP delegates file I/O and terminal ops to the
 * client. This session handles those requests:
 *   - fs/read_text_file, fs/write_text_file
 *   - terminal/* (via gemini-acp-terminals)
 *   - session/request_permission (auto-approve)
 */
import type { ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import type { TerminalStore } from "@/lib/gemini-acp-terminals";
import {
  handleTermCreate,
  handleTermOutput,
  handleTermWait,
  handleTermKill,
  handleTermRelease,
} from "@/lib/gemini-acp-terminals";

// ── Types ─────────────────────────────────────────

export interface GeminiAcpSession {
  readonly sessionId: string | null;
  readonly ready: boolean;
  processLine(
    host: ChildProcess,
    parsed: Record<string, unknown>,
  ): Record<string, unknown> | null;
  sendHandshake(child: ChildProcess): void;
  startTurn(
    child: ChildProcess, prompt: string,
  ): boolean;
  interruptTurn(child: ChildProcess): boolean;
}

interface AcpState {
  nextId: number;
  sessionId: string | null;
  ready: boolean;
  activePromptId: number | null;
  pendingTurn: {
    child: ChildProcess; prompt: string;
  } | null;
  termStore: TerminalStore;
}

// ── Constants ─────────────────────────────────────

const INIT_ID = 1;
const NEW_SESSION_ID = 2;

// ── Low-level I/O ─────────────────────────────────

function writeJson(
  child: ChildProcess,
  obj: Record<string, unknown>,
): boolean {
  if (
    !child.stdin ||
    child.stdin.destroyed ||
    child.stdin.writableEnded
  ) {
    return false;
  }
  try {
    child.stdin.write(JSON.stringify(obj) + "\n");
    return true;
  } catch {
    return false;
  }
}

function respond(
  host: ChildProcess,
  id: unknown,
  result: Record<string, unknown>,
): void {
  writeJson(host, { jsonrpc: "2.0", id, result });
}

function respondError(
  host: ChildProcess,
  id: unknown,
  code: number,
  message: string,
): void {
  writeJson(host, {
    jsonrpc: "2.0", id,
    error: { code, message },
  });
}

// ── Handshake response handling ───────────────────

function handleHandshake(
  parsed: Record<string, unknown>,
  s: AcpState,
): void {
  const id = parsed.id;
  const result =
    parsed.result as
      Record<string, unknown> | undefined;
  if (id === INIT_ID) return;
  if (id === NEW_SESSION_ID && result) {
    if (typeof result.sessionId === "string") {
      s.sessionId = result.sessionId;
      s.ready = true;
      flushPending(s);
    }
  }
}

function flushPending(s: AcpState): void {
  if (!s.pendingTurn || !s.sessionId) return;
  const { child, prompt } = s.pendingTurn;
  s.pendingTurn = null;
  const id = s.nextId++;
  s.activePromptId = id;
  writeJson(child, {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: s.sessionId,
      prompt: [{ type: "text", text: prompt }],
    },
  });
}

// ── Notification translation ──────────────────────

function translateNotif(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  if (method !== "session/update") return null;
  const update =
    params.update as
      Record<string, unknown> | undefined;
  if (!update) return null;
  const kind = update.sessionUpdate;

  if (
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk"
  ) {
    return translateChunk(update);
  }
  if (kind === "tool_call") {
    const name =
      typeof update.name === "string"
        ? update.name
        : typeof update.title === "string"
          ? update.title : "tool";
    return {
      type: "message", role: "assistant",
      content: `[tool] ${name}`, delta: true,
    };
  }
  if (kind === "tool_call_update") {
    const status =
      typeof update.status === "string"
        ? update.status : null;
    if (status === "completed" || status === "failed") {
      const title =
        typeof update.title === "string"
          ? update.title : "";
      return {
        type: "message", role: "assistant",
        content: `[tool:${status}] ${title}`,
        delta: true,
      };
    }
  }
  return null;
}

function translateChunk(
  update: Record<string, unknown>,
): Record<string, unknown> | null {
  const content =
    update.content as
      Record<string, unknown> | undefined;
  if (!content) return null;
  const text =
    typeof content.text === "string"
      ? content.text : "";
  if (!text) return null;
  return {
    type: "message", role: "assistant",
    content: text, delta: true,
  };
}

// ── Client-side request dispatch ──────────────────

function dispatch(
  host: ChildProcess,
  method: string,
  id: unknown,
  params: Record<string, unknown>,
  s: AcpState,
): void {
  switch (method) {
    case "session/request_permission":
      handlePermission(host, id, params);
      break;
    case "fs/read_text_file":
      handleFsRead(host, id, params);
      break;
    case "fs/write_text_file":
      handleFsWrite(host, id, params);
      break;
    case "terminal/create":
      handleTermCreate(
        host, id, params,
        s.termStore, respond,
      );
      break;
    case "terminal/output":
      handleTermOutput(
        host, id, params,
        s.termStore, respond, respondError,
      );
      break;
    case "terminal/wait_for_exit":
      handleTermWait(
        host, id, params,
        s.termStore, respond, respondError,
      );
      break;
    case "terminal/kill":
      handleTermKill(
        host, id, params,
        s.termStore, respond, respondError,
      );
      break;
    case "terminal/release":
      handleTermRelease(
        host, id, params,
        s.termStore, respond,
      );
      break;
    default:
      respondError(
        host, id, -32601,
        `Not implemented: ${method}`,
      );
  }
}

function handlePermission(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
): void {
  const options = params.options as
    Array<Record<string, unknown>> | undefined;
  const allowOpt = options?.find(
    (o) => o.kind === "allow_once",
  );
  const optionId =
    typeof allowOpt?.id === "string"
      ? allowOpt.id : "allow_once";
  respond(host, id, {
    permissionOptionId: optionId,
  });
}

function handleFsRead(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
): void {
  const path =
    typeof params.path === "string"
      ? params.path : "";
  const limit =
    typeof params.limit === "number"
      ? params.limit : undefined;
  const line =
    typeof params.line === "number"
      ? params.line : undefined;

  readFile(path, "utf-8")
    .then((raw) => {
      let text = raw;
      if (line !== undefined) {
        const lines = text.split("\n");
        const start = Math.max(0, line);
        const end = limit
          ? start + limit : lines.length;
        text = lines.slice(start, end).join("\n");
      } else if (limit !== undefined) {
        text = text.slice(0, limit);
      }
      respond(host, id, { text });
    })
    .catch((err: Error) => {
      respondError(host, id, -1, err.message);
    });
}

function handleFsWrite(
  host: ChildProcess,
  id: unknown,
  params: Record<string, unknown>,
): void {
  const path =
    typeof params.path === "string"
      ? params.path : "";
  const content =
    typeof params.content === "string"
      ? params.content : "";
  writeFile(path, content, "utf-8")
    .then(() => respond(host, id, {}))
    .catch((err: Error) => {
      respondError(host, id, -1, err.message);
    });
}

// ── Factory ───────────────────────────────────────

export function createGeminiAcpSession(
  cwd: string,
): GeminiAcpSession {
  const s: AcpState = {
    nextId: 3,
    sessionId: null,
    ready: false,
    activePromptId: null,
    pendingTurn: null,
    termStore: {
      terminals: new Map(),
      nextId: 1,
      cwd,
    },
  };

  return {
    get sessionId() { return s.sessionId; },
    get ready() { return s.ready; },

    processLine(host, parsed) {
      return doProcessLine(host, parsed, s);
    },

    sendHandshake(child) {
      writeJson(child, {
        jsonrpc: "2.0", id: INIT_ID,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: {
            name: "foolery", version: "1.0.0",
          },
        },
      });
      writeJson(child, {
        jsonrpc: "2.0", id: NEW_SESSION_ID,
        method: "session/new",
        params: { cwd, mcpServers: [] },
      });
    },

    startTurn(child, prompt) {
      if (!s.ready || !s.sessionId) {
        s.pendingTurn = { child, prompt };
        return true;
      }
      const id = s.nextId++;
      s.activePromptId = id;
      return writeJson(child, {
        jsonrpc: "2.0", id,
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
      // session/cancel is a notification (no id)
      return writeJson(child, {
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: s.sessionId },
      });
    },
  };
}

function doProcessLine(
  host: ChildProcess,
  parsed: Record<string, unknown>,
  s: AcpState,
): Record<string, unknown> | null {
  // Response to our request
  if ("id" in parsed && "result" in parsed) {
    if (parsed.id === s.activePromptId) {
      s.activePromptId = null;
      handleHandshake(parsed, s);
      const stop =
        (parsed.result as
          Record<string, unknown>
        )?.stopReason;
      const isErr =
        stop !== "end_turn" && stop !== undefined;
      return {
        type: "result",
        status: isErr ? "error" : "success",
      };
    }
    handleHandshake(parsed, s);
    return null;
  }

  // Error response
  if ("id" in parsed && "error" in parsed) {
    const err =
      parsed.error as
        Record<string, unknown> | undefined;
    const msg =
      typeof err?.message === "string"
        ? err.message : "ACP error";
    console.error(
      `[gemini-acp] error id=${parsed.id}: ${msg}`,
    );
    if (parsed.id === s.activePromptId) {
      s.activePromptId = null;
      return { type: "result", status: "error" };
    }
    return null;
  }

  // Client-side request (has id + method)
  if (
    "id" in parsed &&
    "method" in parsed &&
    typeof parsed.method === "string"
  ) {
    dispatch(
      host, parsed.method, parsed.id,
      (parsed.params as
        Record<string, unknown>) ?? {},
      s,
    );
    return null;
  }

  // Notification (method, no id)
  if (
    "method" in parsed &&
    typeof parsed.method === "string"
  ) {
    return translateNotif(
      parsed.method,
      (parsed.params as
        Record<string, unknown>) ?? {},
    );
  }

  return null;
}
