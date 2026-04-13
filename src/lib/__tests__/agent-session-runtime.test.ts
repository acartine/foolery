import {
  describe, it, expect, vi,
  beforeEach, afterEach,
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

// ── Helpers ────────────────────────────────────────────

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

function makeChild(
  interactive: boolean,
): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = interactive
    ? new PassThrough() : null;
  return {
    stdout,
    stderr,
    stdin,
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(
  dialect: "claude" | "codex" | "gemini",
  overrides?: Partial<SessionRuntimeConfig>,
): SessionRuntimeConfig {
  const capabilities =
    resolveCapabilities(dialect);
  return {
    id: "test-session",
    dialect,
    capabilities,
    watchdogTimeoutMs: null,
    normalizeEvent:
      createLineNormalizer(dialect),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    ...overrides,
  };
}

function makeInteractiveCodexConfig(
  overrides?: Partial<SessionRuntimeConfig>,
): SessionRuntimeConfig {
  const jsonrpcSession =
    createCodexJsonRpcSession();
  const capabilities = resolveCapabilities(
    "codex", true,
  );
  return {
    id: "test-session",
    dialect: "codex",
    capabilities,
    watchdogTimeoutMs: null,
    normalizeEvent: createLineNormalizer("codex"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    jsonrpcSession,
    ...overrides,
  };
}

// ── Initial state & stdin ──────────────────────────────

describe("runtime: initial state", () => {
  it("interactive dialect has open stdin", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    expect(rt.state.stdinClosed).toBe(false);
    expect(rt.state.resultObserved).toBe(false);
  });

  it("one-shot dialect has closed stdin", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    expect(rt.state.stdinClosed).toBe(true);
  });
});

describe("runtime: sendUserTurn", () => {
  it("writes to stdin for interactive", () => {
    const config = makeConfig("claude");
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    const writeSpy = vi.spyOn(
      child.stdin!, "write",
    );
    const sent = rt.sendUserTurn(
      child, "hello", "test",
    );
    expect(sent).toBe(true);
    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0];
    const parsed = JSON.parse(written as string);
    expect(parsed.type).toBe("user");
    expect(
      parsed.message.content[0].text,
    ).toBe("hello");
  });

  it("returns false for one-shot", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    const child = makeChild(false);
    expect(
      rt.sendUserTurn(child, "hello"),
    ).toBe(false);
  });
});

describe("runtime: closeInput", () => {
  it("ends stdin and marks closed", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.closeInput(child);
    expect(rt.state.stdinClosed).toBe(true);
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("is idempotent", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.closeInput(child);
    rt.closeInput(child);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

// ── Scheduled close & dispose ──────────────────────────

describe("runtime: scheduleInputClose", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("closes after grace period", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.scheduleInputClose(child);
    expect(endSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("cancel prevents close", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.scheduleInputClose(child);
    rt.cancelInputClose();
    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });
});

describe("runtime: dispose", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("cancels timers and marks closed", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.scheduleInputClose(child);
    rt.dispose();
    expect(rt.state.stdinClosed).toBe(true);
    expect(rt.state.closeInputTimer).toBeNull();
  });
});

// ── Claude stdout ──────────────────────────────────────

describe("runtime: claude stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sets resultObserved on result event", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    const line = JSON.stringify({
      type: "result",
      result: "done",
      is_error: false,
    });
    child.stdout!.emit(
      "data", Buffer.from(line + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.exitReason).toBe(
      "result_observed",
    );
  });

  it("auto-answers AskUserQuestion", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    const writeSpy = vi.spyOn(
      child.stdin!, "write",
    );
    rt.wireStdout(child);
    const askEvent = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "tool-123456789012",
          name: "AskUserQuestion",
          input: {
            questions: [{
              question: "Continue?",
              options: [{ label: "Yes" }],
            }],
          },
        }],
      },
    });
    child.stdout!.emit(
      "data", Buffer.from(askEvent + "\n"),
    );
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(
      rt.state.autoAnsweredToolUseIds.has(
        "tool-123456789012",
      ),
    ).toBe(true);
  });
});

// ── Codex stdout ───────────────────────────────────────

describe("runtime: codex stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not auto-answer AskUser", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "hello",
      },
    });
    child.stdout.emit(
      "data", Buffer.from(line + "\n"),
    );
    expect(
      rt.state.autoAnsweredToolUseIds.size,
    ).toBe(0);
  });

  it("normalizes turn.completed to result", () => {
    const rt = createSessionRuntime(
      makeConfig("codex"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Done",
        },
      }) + "\n"),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "turn.completed",
        usage: {},
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
  });
});

// ── Interactive Codex (JSON-RPC) ─────────────────────

describe("runtime: interactive codex state", () => {
  it("has open stdin for interactive codex", () => {
    const rt = createSessionRuntime(
      makeInteractiveCodexConfig(),
    );
    expect(rt.state.stdinClosed).toBe(false);
  });

  it(
    "sendUserTurn delegates to jsonrpc startTurn",
    () => {
      const config = makeInteractiveCodexConfig();
      const rt = createSessionRuntime(config);
      const child = makeChild(true);
      const writeSpy = vi.spyOn(
        child.stdin!, "write",
      );
      const jrpc = config.jsonrpcSession!;
      jrpc.sendHandshake(child);
      writeSpy.mockClear();
      jrpc.processLine({
        id: 1, result: { userAgent: "test" },
      });
      jrpc.processLine({
        id: 2,
        result: { thread: { id: "t-1" } },
      });
      const sent = rt.sendUserTurn(
        child, "do work", "test",
      );
      expect(sent).toBe(true);
      expect(writeSpy).toHaveBeenCalled();
      const lastWrite = writeSpy.mock.calls[
        writeSpy.mock.calls.length - 1
      ][0] as string;
      const parsed = JSON.parse(lastWrite);
      expect(parsed.method).toBe("turn/start");
    },
  );
});

describe("runtime: interactive codex stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("translates turn/completed to result", () => {
    const config = makeInteractiveCodexConfig();
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    rt.wireStdout(child);
    const handshake = [
      JSON.stringify({
        id: 1, result: { userAgent: "t" },
      }),
      JSON.stringify({
        id: 2,
        result: { thread: { id: "t-1" } },
      }),
    ].join("\n") + "\n";
    child.stdout!.emit(
      "data", Buffer.from(handshake),
    );
    expect(rt.state.resultObserved).toBe(false);
    const events = [
      JSON.stringify({
        method: "item/completed",
        params: {
          threadId: "t-1", turnId: "turn-1",
          item: {
            id: "i-1", type: "agentMessage",
            fragments: [{ text: "All done" }],
          },
        },
      }),
      JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: "t-1",
          turn: {
            id: "turn-1", items: [],
            status: "completed",
          },
        },
      }),
    ].join("\n") + "\n";
    child.stdout!.emit(
      "data", Buffer.from(events),
    );
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.exitReason).toBe(
      "result_observed",
    );
  });

  it("filters MCP noise in JSON-RPC mode", () => {
    const config = makeInteractiveCodexConfig();
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    rt.wireStdout(child);
    const noise = JSON.stringify({
      method: "mcpServer/startupStatus/updated",
      params: {
        name: "playwright", status: "starting",
      },
    }) + "\n";
    child.stdout!.emit(
      "data", Buffer.from(noise),
    );
    expect(rt.state.resultObserved).toBe(false);
    expect(
      rt.state.lastNormalizedEvent,
    ).toBeNull();
  });
});
