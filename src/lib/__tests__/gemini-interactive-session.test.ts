/**
 * Runtime integration tests for interactive Gemini
 * sessions via ACP mode.
 *
 * Covers: successful completion, watchdog timeout,
 * retry/abort, follow-up turn delivery, and event
 * normalization through the shared session runtime.
 */
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
  interactiveSessionTimeoutMinutesToMs,
} from "@/lib/interactive-session-timeout";
import {
  createGeminiAcpSession,
} from "@/lib/gemini-acp-session";

const DEFAULT_WATCHDOG_TIMEOUT_MS =
  interactiveSessionTimeoutMinutesToMs(10);

// ── Helpers ──────────────────────────────────────────

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
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  return {
    stdout, stderr, stdin,
    pid: 99999,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(
  overrides?: Partial<SessionRuntimeConfig>,
): SessionRuntimeConfig {
  const acpSession = createGeminiAcpSession("/tmp");
  const caps = resolveCapabilities("gemini", true);
  return {
    id: "gemini-test",
    dialect: "gemini",
    capabilities: caps,
    watchdogTimeoutMs: DEFAULT_WATCHDOG_TIMEOUT_MS,
    normalizeEvent:
      createLineNormalizer("gemini"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    acpSession,
    ...overrides,
  };
}

function emitLine(
  child: ChildProcess,
  obj: Record<string, unknown>,
): void {
  child.stdout!.emit(
    "data",
    Buffer.from(JSON.stringify(obj) + "\n"),
  );
}

/** Complete the ACP handshake for a session. */
function completeHandshake(
  child: ChildProcess,
): void {
  emitLine(child, {
    id: 1, result: { protocolVersion: 1 },
  });
  emitLine(child, {
    id: 2, result: { sessionId: "s1" },
  });
}

// ── Successful completion ────────────────────────────

describe("gemini interactive: completion", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("detects result from prompt response", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "do something", "test");

    emitLine(child, {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done" },
        },
      },
    });
    expect(rt.state.resultObserved).toBe(false);

    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.exitReason).toBe(
      "result_observed",
    );
  });

  it("detects error from ACP error response", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "fail", "test");

    emitLine(child, {
      id: 3,
      error: { code: 429, message: "Rate limit" },
    });
    expect(rt.state.resultObserved).toBe(true);
    expect(
      rt.state.lastNormalizedEvent?.is_error,
    ).toBe(true);
  });

  it("schedules stdin close after result", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "ok", "test");

    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(endSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

// ── Watchdog timeout ─────────────────────────────────

describe("gemini interactive: watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("terminates after the shared 10 minute inactivity timeout", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).not.toBeNull();

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS,
    );
    expect(rt.state.exitReason).toBe("timeout");
    expect(rt.state.watchdogTimer).toBeNull();
  });

  it("resets watchdog on ACP events", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "go", "test");

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS - 5_000,
    );
    emitLine(child, {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        },
      },
    });

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS - 5_000,
    );
    expect(rt.state.exitReason).toBeNull();

    vi.advanceTimersByTime(6_000);
    expect(rt.state.exitReason).toBe("timeout");
  });

  it("does not fire after result observed", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "do", "test");

    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(rt.state.resultObserved).toBe(true);

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS,
    );
    expect(rt.state.exitReason).toBe(
      "result_observed",
    );
  });
});

// ── Follow-up turn / retry ───────────────────────────

describe("gemini interactive: follow-up", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends follow-up via onResult callback", () => {
    const onResult = vi.fn(() => true);
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession, onResult }),
    );
    const child = makeChild();
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "first", "test");

    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(onResult).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("resets resultObserved after new turn", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "first", "test");

    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });
    expect(rt.state.resultObserved).toBe(true);

    rt.cancelInputClose();
    rt.sendUserTurn(child, "next", "take_2");
    expect(rt.state.resultObserved).toBe(false);

    emitLine(child, {
      id: 4,
      result: { stopReason: "end_turn" },
    });
    expect(rt.state.resultObserved).toBe(true);
  });

  it("times out when follow-up hangs", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession, watchdogTimeoutMs: 5_000 }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "first", "test");

    emitLine(child, {
      id: 3,
      result: { stopReason: "end_turn" },
    });

    rt.cancelInputClose();
    rt.sendUserTurn(child, "next", "take_2");
    expect(rt.state.exitReason).toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(rt.state.exitReason).toBe("timeout");
  });
});

// ── Abort ────────────────────────────────────────────

describe("gemini interactive: abort", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("dispose clears watchdog and closes stdin", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).not.toBeNull();
    expect(rt.state.stdinClosed).toBe(false);

    rt.dispose();
    expect(rt.state.watchdogTimer).toBeNull();
    expect(rt.state.stdinClosed).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(rt.state.exitReason).toBeNull();
  });

  it("sendUserTurn returns false after dispose", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const rt = createSessionRuntime(
      makeConfig({ acpSession }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    rt.dispose();

    const sent = rt.sendUserTurn(
      child, "too late", "manual",
    );
    expect(sent).toBe(false);
  });
});

// ── Event normalization ──────────────────────────────

describe("gemini interactive: normalization", () => {
  it("normalizes agent_message_chunk", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const pushEvent = vi.fn();
    const rt = createSessionRuntime(
      makeConfig({ acpSession, pushEvent }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "go", "test");

    emitLine(child, {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text", text: "Hello world",
          },
        },
      },
    });

    const stdoutEvents = pushEvent.mock.calls
      .filter(([evt]) => evt.type === "stdout");
    expect(stdoutEvents.length).toBeGreaterThan(0);
  });

  it("normalizes tool_call", () => {
    const acpSession = createGeminiAcpSession("/tmp");
    const pushEvent = vi.fn();
    const rt = createSessionRuntime(
      makeConfig({ acpSession, pushEvent }),
    );
    const child = makeChild();
    rt.wireStdout(child);
    completeHandshake(child);
    rt.sendUserTurn(child, "edit file", "test");

    emitLine(child, {
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          title: "EditFile: src/main.ts",
          toolCallId: "tc1",
          status: "in_progress",
        },
      },
    });

    const stdoutEvents = pushEvent.mock.calls
      .filter(([evt]) => evt.type === "stdout");
    expect(stdoutEvents.length).toBeGreaterThan(0);
  });
});
