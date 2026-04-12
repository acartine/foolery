import {
  describe, it, expect, vi,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";

// ── Helpers ──────────────────────────────────────────

function makeChild(): ChildProcess {
  const stdin = new PassThrough();
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin,
    pid: 99999,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function captureWrites(
  child: ChildProcess,
): string[] {
  const writes: string[] = [];
  const origWrite = child.stdin!.write.bind(
    child.stdin,
  );
  vi.spyOn(child.stdin!, "write").mockImplementation(
    (chunk: unknown) => {
      writes.push(chunk as string);
      return origWrite(chunk);
    },
  );
  return writes;
}

function parseWrites(
  writes: string[],
): Record<string, unknown>[] {
  return writes.map((w) => JSON.parse(w));
}

function readySession() {
  const session = createCodexJsonRpcSession();
  session.processLine({
    id: 1,
    result: { userAgent: "test" },
  });
  session.processLine({
    id: 2,
    result: {
      thread: { id: "t-1" },
    },
  });
  return session;
}

// ── Handshake ────────────────────────────────────────

describe("codex-jsonrpc: handshake", () => {
  it("sends initialize and thread/start", () => {
    const session = createCodexJsonRpcSession();
    const child = makeChild();
    const writes = captureWrites(child);

    session.sendHandshake(child);

    const msgs = parseWrites(writes);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].method).toBe("initialize");
    expect(msgs[0].id).toBe(1);
    expect(msgs[1].method).toBe("thread/start");
    expect(msgs[1].id).toBe(2);
    const params =
      msgs[1].params as Record<string, unknown>;
    expect(params.approvalPolicy).toBe("never");
  });

  it("sets ready after thread/start response", () => {
    const session = createCodexJsonRpcSession();
    expect(session.ready).toBe(false);
    expect(session.threadId).toBeNull();

    // Simulate initialize response
    session.processLine({
      id: 1,
      result: { userAgent: "test/1.0" },
    });
    expect(session.ready).toBe(false);

    // Simulate thread/start response
    session.processLine({
      id: 2,
      result: {
        thread: {
          id: "thread-abc-123",
          preview: "",
        },
        model: "gpt-5",
      },
    });
    expect(session.ready).toBe(true);
    expect(session.threadId).toBe("thread-abc-123");
  });
});

// ── Turn lifecycle ───────────────────────────────────

describe("codex-jsonrpc: turn lifecycle", () => {
  it("startTurn sends turn/start request", () => {
    const session = readySession();
    const child = makeChild();
    const writes = captureWrites(child);

    const sent = session.startTurn(
      child, "do the thing",
    );
    expect(sent).toBe(true);

    const msgs = parseWrites(writes);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].method).toBe("turn/start");
    const params =
      msgs[0].params as Record<string, unknown>;
    expect(params.threadId).toBe("t-1");
    const input = params.input as Array<
      Record<string, unknown>
    >;
    expect(input[0].text).toBe("do the thing");
  });

  it("queues turn if handshake not ready", () => {
    const session = createCodexJsonRpcSession();
    const child = makeChild();
    const writes = captureWrites(child);

    // Send turn before handshake completes
    const sent = session.startTurn(
      child, "queued prompt",
    );
    expect(sent).toBe(true);
    expect(writes).toHaveLength(0);

    // Send handshake
    session.sendHandshake(child);
    writes.length = 0; // clear handshake writes

    // Complete handshake — should flush pending
    session.processLine({
      id: 1, result: { userAgent: "test" },
    });
    session.processLine({
      id: 2,
      result: { thread: { id: "t-2" } },
    });

    const msgs = parseWrites(writes);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].method).toBe("turn/start");
    const params =
      msgs[0].params as Record<string, unknown>;
    expect(params.threadId).toBe("t-2");
  });

  it("emits deferred and dispatched prompt delivery hooks", () => {
    const hooks = {
      onDeferred: vi.fn(),
      onAttempted: vi.fn(),
      onSucceeded: vi.fn(),
      onFailed: vi.fn(),
    };
    const session = createCodexJsonRpcSession(hooks);
    const child = makeChild();

    expect(session.startTurn(child, "queued prompt")).toBe(
      true,
    );
    expect(hooks.onDeferred).toHaveBeenCalledWith(
      "awaiting_thread_start",
    );

    session.processLine({
      id: 1,
      result: { userAgent: "test" },
    });
    session.processLine({
      id: 2,
      result: { thread: { id: "t-2" } },
    });

    expect(hooks.onAttempted).toHaveBeenCalled();
    expect(hooks.onSucceeded).toHaveBeenCalled();
    expect(hooks.onFailed).not.toHaveBeenCalled();
  });

  it("interruptTurn sends turn/interrupt", () => {
    const session = readySession();
    const child = makeChild();
    const writes = captureWrites(child);

    session.startTurn(child, "work");
    // Simulate turn/start response (id=3, first
    // turn ID after handshake IDs 1,2)
    session.processLine({
      id: 3,
      result: {
        turn: { id: "turn-99", status: "inProgress" },
      },
    });
    writes.length = 0;

    const ok = session.interruptTurn(child);
    expect(ok).toBe(true);
    const msgs = parseWrites(writes);
    expect(msgs[0].method).toBe("turn/interrupt");
  });

  it("interruptTurn returns false with no turn", () => {
    const session = readySession();
    const child = makeChild();
    expect(session.interruptTurn(child)).toBe(false);
  });
});

// ── Turn notification translation ────────────────────

describe("codex-jsonrpc: turn notifications", () => {
  it("translates turn/started", () => {
    const session = createCodexJsonRpcSession();
    const result = session.processLine({
      method: "turn/started",
      params: {
        threadId: "t-1",
        turn: {
          id: "turn-1", status: "inProgress",
        },
      },
    });
    expect(result).toEqual({
      type: "turn.started",
    });
  });

  it("translates turn/completed", () => {
    const session = createCodexJsonRpcSession();
    const result = session.processLine({
      method: "turn/completed",
      params: {
        threadId: "t-1",
        turn: {
          id: "turn-1", items: [],
          status: "completed",
        },
      },
    });
    expect(result).toEqual({
      type: "turn.completed",
    });
  });

  it("translates turn/completed (failed)", () => {
    const session = createCodexJsonRpcSession();
    const result = session.processLine({
      method: "turn/completed",
      params: {
        threadId: "t-1",
        turn: {
          id: "turn-1", items: [],
          status: "failed",
          error: { message: "rate limit" },
        },
      },
    });
    expect(result).toEqual({
      type: "turn.failed",
      error: { message: "rate limit" },
    });
  });
});

// ── Item notification translation ────────────────────

describe("codex-jsonrpc: item notifications", () => {
  it("translates item/started command", () => {
    const session = createCodexJsonRpcSession();
    const result = session.processLine({
      method: "item/started",
      params: {
        threadId: "t-1", turnId: "turn-1",
        item: {
          id: "item-1",
          type: "commandExecution",
          command: "ls -la",
        },
      },
    });
    expect(result).toEqual({
      type: "item.started",
      item: {
        type: "command_execution",
        id: "item-1",
        command: "ls -la",
        aggregated_output: "",
      },
    });
  });

  it("translates item/completed agentMessage", () => {
    const session = createCodexJsonRpcSession();
    const result = session.processLine({
      method: "item/completed",
      params: {
        threadId: "t-1", turnId: "turn-1",
        item: {
          id: "item-2", type: "agentMessage",
          fragments: [
            { type: "outputText", text: "Done!" },
          ],
        },
      },
    });
    expect(result).toEqual({
      type: "item.completed",
      item: {
        type: "agent_message",
        id: "item-2", text: "Done!",
      },
    });
  });

  it("translates item/completed command", () => {
    const session = createCodexJsonRpcSession();
    const result = session.processLine({
      method: "item/completed",
      params: {
        threadId: "t-1", turnId: "turn-1",
        item: {
          id: "item-3",
          type: "commandExecution",
          command: "echo hi",
          output: "hi\n",
        },
      },
    });
    expect(result).toEqual({
      type: "item.completed",
      item: {
        type: "command_execution",
        id: "item-3", command: "echo hi",
        aggregated_output: "hi\n",
      },
    });
  });
});

// ── Filtering and errors ─────────────────────────────

describe("codex-jsonrpc: filtering", () => {
  it("filters MCP startup notifications", () => {
    const session = createCodexJsonRpcSession();
    expect(session.processLine({
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "chrome-devtools",
        status: "starting", error: null,
      },
    })).toBeNull();
  });

  it("filters thread/started notifications", () => {
    const session = createCodexJsonRpcSession();
    expect(session.processLine({
      method: "thread/started",
      params: {
        thread: { id: "t-1", preview: "" },
      },
    })).toBeNull();
  });

  it("handles JSON-RPC error responses", () => {
    const session = createCodexJsonRpcSession();
    const spy = vi.spyOn(console, "error")
      .mockImplementation(() => {});
    session.processLine({
      id: 99,
      error: {
        code: -32600, message: "bad request",
      },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("bad request"),
    );
    spy.mockRestore();
  });
});

// ── Edge cases ───────────────────────────────────────

describe("codex-jsonrpc: edge cases", () => {
  it("returns null for unknown message shapes", () => {
    const session = createCodexJsonRpcSession();
    expect(session.processLine({})).toBeNull();
    expect(
      session.processLine({ foo: "bar" }),
    ).toBeNull();
  });

  it(
    "startTurn returns false with destroyed stdin",
    () => {
      const session = createCodexJsonRpcSession();
      session.processLine({
        id: 1, result: { userAgent: "test" },
      });
      session.processLine({
        id: 2,
        result: { thread: { id: "t-1" } },
      });
      const child = makeChild();
      child.stdin!.destroy();
      expect(
        session.startTurn(child, "hello"),
      ).toBe(false);
    },
  );
});
