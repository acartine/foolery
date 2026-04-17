/**
 * foolery-a401 regression canary.
 *
 * These tests prove that the `onTurnEnded` follow-up
 * callback fires for ALL four transports — not just
 * Claude stdio. Before this knot shipped, the payload
 * gate `if (obj.type === "result")` lived in the
 * generic runtime core, which meant Codex / Gemini /
 * OpenCode could NEVER fire `onTurnEnded` because their
 * terminators are `turn.completed`, translator-emitted
 * `result`, and `step_finish` respectively.
 *
 * If any of these tests regress, DO NOT patch the test.
 * Instead, audit whether someone has reintroduced a
 * payload-shape gate in `agent-session-runtime*`. That
 * is the exact fake-fix pattern this knot eradicates.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createSessionRuntime,
  type SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";
import {
  createCodexJsonRpcSession,
} from "@/lib/codex-jsonrpc-session";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";
import {
  createOpenCodeHttpSession,
} from "@/lib/opencode-http-session";

// ── Fixtures ─────────────────────────────────────────

function makeInteractionLog() {
  return {
    logStdout: vi.fn(),
    logStderr: vi.fn(),
    logResponse: vi.fn(),
    logPrompt: vi.fn(),
    logEnd: vi.fn(),
    logBeatState: vi.fn(),
    filePath: null,
  } as unknown as
    import("@/lib/interaction-logger").InteractionLog;
}

function makeChild(): ChildProcess {
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: 424242,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function baseConfig(
  dialect: "claude" | "codex" | "gemini" | "opencode",
  overrides: Partial<SessionRuntimeConfig> = {},
): SessionRuntimeConfig {
  return {
    id: "a401-test",
    dialect,
    capabilities: resolveCapabilities(dialect, true),
    watchdogTimeoutMs: null,
    normalizeEvent: createLineNormalizer(dialect),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-a401"],
    ...overrides,
  };
}

function emitLine(
  child: ChildProcess,
  obj: Record<string, unknown>,
): void {
  child.stdout!.emit(
    "data", Buffer.from(JSON.stringify(obj) + "\n"),
  );
}

// ── stdio (Claude) ───────────────────────────────────

describe("onTurnEnded: stdio (Claude stream-json)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires on {type: 'result'}", () => {
    const onTurnEnded = vi.fn(() => true);
    const rt = createSessionRuntime(
      baseConfig("claude", { onTurnEnded }),
    );
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "result",
      result: "done",
      is_error: false,
    });

    expect(onTurnEnded).toHaveBeenCalledOnce();
    expect(rt.state.exitReason).toBe("turn_ended");
  });
});

// ── jsonrpc (Codex) ─────────────────────────────────

describe("onTurnEnded: jsonrpc (Codex)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /**
   * The definitive proof that foolery-a401 is a real
   * fix and not fake-fixed-again: a Codex JSON-RPC
   * `turn/completed` notification MUST trigger the
   * follow-up callback. Before the rename, this test
   * would never pass because the generic runtime gate
   * only accepted `type === "result"`.
   */
  it("fires on turn/completed notification", () => {
    const onTurnEnded = vi.fn(() => true);
    const jsonrpcSession = createCodexJsonRpcSession();
    const rt = createSessionRuntime(baseConfig("codex", {
      jsonrpcSession,
      onTurnEnded,
    }));
    const child = makeChild();
    rt.wireStdout(child);

    // Complete the Codex handshake
    emitLine(child, {
      id: 1, result: { userAgent: "test" },
    });
    emitLine(child, {
      id: 2, result: { thread: { id: "t-42" } },
    });

    // The terminator: Codex emits a JSON-RPC
    // notification, NOT `{type: "result"}`.
    emitLine(child, {
      method: "turn/completed",
      params: {
        threadId: "t-42",
        turn: {
          id: "turn-42", items: [],
          status: "completed",
        },
      },
    });

    expect(onTurnEnded).toHaveBeenCalledOnce();
    expect(rt.state.exitReason).toBe("turn_ended");
  });

  it("fires on turn.failed (error path)", () => {
    const onTurnEnded = vi.fn(() => true);
    const jsonrpcSession = createCodexJsonRpcSession();
    const rt = createSessionRuntime(baseConfig("codex", {
      jsonrpcSession,
      onTurnEnded,
    }));
    const child = makeChild();
    rt.wireStdout(child);
    emitLine(child, {
      id: 1, result: { userAgent: "test" },
    });
    emitLine(child, {
      id: 2, result: { thread: { id: "t-42" } },
    });

    emitLine(child, {
      method: "turn/completed",
      params: {
        threadId: "t-42",
        turn: {
          id: "turn-42",
          status: "failed",
          error: { message: "boom" },
        },
      },
    });

    expect(onTurnEnded).toHaveBeenCalledOnce();
  });
});

// ── acp (Gemini) ────────────────────────────────────

describe("onTurnEnded: acp (Gemini)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires when prompt response resolves", () => {
    const onTurnEnded = vi.fn(() => true);
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(baseConfig("gemini", {
      acpSession,
      onTurnEnded,
    }));
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      id: 1, result: { protocolVersion: 1 },
    });
    emitLine(child, {
      id: 2, result: { sessionId: "s-42" },
    });
    rt.sendUserTurn(child, "do work", "test");

    // ACP session terminator: the client's own prompt
    // request returns a result with `stopReason`.
    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });

    expect(onTurnEnded).toHaveBeenCalledOnce();
    expect(rt.state.exitReason).toBe("turn_ended");
  });
});

// ── http (OpenCode) ─────────────────────────────────

describe("onTurnEnded: http (OpenCode)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires on injected step_finish event", () => {
    const onTurnEnded = vi.fn(() => true);
    // httpSession just needs to exist; we inject the
    // translator's output directly via injectLine to
    // simulate the HTTP response pipeline.
    const httpSession = createOpenCodeHttpSession(
      vi.fn(), vi.fn(),
    );
    const rt = createSessionRuntime(baseConfig("opencode", {
      httpSession,
      onTurnEnded,
    }));
    const child = makeChild();

    // HTTP transport: server writes `step_finish`
    // JSON to the runtime through `injectLine`.
    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "stop" },
    }));

    expect(onTurnEnded).toHaveBeenCalledOnce();
    expect(rt.state.exitReason).toBe("turn_ended");
  });
});

// ── Canary: unrelated events must NOT fire ──────────

describe("onTurnEnded: canary (unrelated events)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does NOT fire on Codex item.completed", () => {
    const onTurnEnded = vi.fn(() => true);
    const jsonrpcSession = createCodexJsonRpcSession();
    const rt = createSessionRuntime(baseConfig("codex", {
      jsonrpcSession,
      onTurnEnded,
    }));
    const child = makeChild();
    rt.wireStdout(child);
    emitLine(child, {
      id: 1, result: { userAgent: "test" },
    });
    emitLine(child, {
      id: 2, result: { thread: { id: "t-canary" } },
    });

    // item/completed is NOT a turn-ended signal
    emitLine(child, {
      method: "item/completed",
      params: {
        threadId: "t-canary",
        turnId: "turn-canary",
        item: {
          id: "i-1", type: "agentMessage",
          fragments: [{ text: "intermediate" }],
        },
      },
    });

    expect(onTurnEnded).not.toHaveBeenCalled();
    expect(rt.state.exitReason).toBeNull();
  });

  it("does NOT fire on stdio non-result messages", () => {
    const onTurnEnded = vi.fn(() => true);
    const rt = createSessionRuntime(
      baseConfig("claude", { onTurnEnded }),
    );
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "thinking" }],
      },
    });

    expect(onTurnEnded).not.toHaveBeenCalled();
  });

  it("does NOT fire on opencode text deltas", () => {
    const onTurnEnded = vi.fn(() => true);
    const httpSession = createOpenCodeHttpSession(
      vi.fn(), vi.fn(),
    );
    const rt = createSessionRuntime(baseConfig("opencode", {
      httpSession,
      onTurnEnded,
    }));
    const child = makeChild();

    rt.injectLine(child, JSON.stringify({
      type: "text",
      part: { text: "mid-turn chatter" },
    }));

    expect(onTurnEnded).not.toHaveBeenCalled();
  });
});

// ── signalTurnEnded is transport-neutral ───────────

describe("runtime.signalTurnEnded", () => {
  it("fires onTurnEnded regardless of payload", () => {
    const onTurnEnded = vi.fn(() => true);
    const rt = createSessionRuntime(
      baseConfig("claude", { onTurnEnded }),
    );
    const child = makeChild();

    // No event has been processed — the runtime has
    // no way to know the turn ended. But the transport
    // adapter can explicitly signal it.
    rt.signalTurnEnded(child, {
      eventType: "synthetic",
      isError: false,
    });

    expect(onTurnEnded).toHaveBeenCalledOnce();
    expect(rt.state.exitReason).toBe("turn_ended");
  });
});
