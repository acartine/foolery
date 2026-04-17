/**
 * Regression tests for interactive Copilot sessions.
 *
 * Covers: successful completion, watchdog timeout,
 * retry/abort, follow-up turn delivery, and stdin
 * message format.
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
    stdout,
    stderr,
    stdin,
    pid: 99999,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(
  overrides?: Partial<SessionRuntimeConfig>,
): SessionRuntimeConfig {
  const caps = resolveCapabilities("copilot", true);
  return {
    id: "copilot-test",
    dialect: "copilot",
    capabilities: caps,
    watchdogTimeoutMs: DEFAULT_WATCHDOG_TIMEOUT_MS,
    normalizeEvent:
      createLineNormalizer("copilot"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
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

// ── Successful completion ────────────────────────────

describe("copilot interactive: completion", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("detects result from session.task_complete", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "assistant.message_delta",
      data: { messageId: "m1", deltaContent: "Done" },
    });
    expect(rt.state.resultObserved).toBe(false);

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true, summary: "ok" },
    });
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.exitReason).toBe(
      "turn_ended",
    );
  });

  it("detects error result from session.error", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "session.error",
      data: { message: "Rate limit hit" },
    });
    expect(rt.state.resultObserved).toBe(true);
    expect(
      rt.state.lastNormalizedEvent?.is_error,
    ).toBe(true);
  });

  it("schedules stdin close after result", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true },
    });
    expect(endSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

// ── Watchdog timeout ─────────────────────────────────

describe("copilot interactive: watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("terminates after the shared 10 minute inactivity timeout", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).not.toBeNull();

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS,
    );
    expect(rt.state.exitReason).toBe("timeout");
    expect(rt.state.watchdogTimer).toBeNull();
  });

  it("resets watchdog on copilot events", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS - 5_000,
    );
    emitLine(child, {
      type: "assistant.message_delta",
      data: { messageId: "m1", deltaContent: "hi" },
    });

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS - 5_000,
    );
    expect(rt.state.exitReason).toBeNull();

    vi.advanceTimersByTime(6_000);
    expect(rt.state.exitReason).toBe("timeout");
  });

  it("does not fire after result observed", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true },
    });
    expect(rt.state.resultObserved).toBe(true);

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS,
    );
    expect(rt.state.exitReason).toBe(
      "turn_ended",
    );
  });
});

// ── Follow-up turn / retry ───────────────────────────

describe("copilot interactive: follow-up", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends follow-up via onTurnEnded callback", () => {
    const onTurnEnded = vi.fn(() => true);
    const rt = createSessionRuntime(
      makeConfig({ onTurnEnded }),
    );
    const child = makeChild();
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true },
    });
    expect(onTurnEnded).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("sends copilot-format user turn on stdin", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    const writeSpy = vi.spyOn(child.stdin!, "write");
    rt.wireStdout(child);

    const sent = rt.sendUserTurn(
      child, "follow up", "take_2",
    );
    expect(sent).toBe(true);
    expect(writeSpy).toHaveBeenCalledOnce();

    const written = writeSpy.mock.calls[0][0];
    const parsed = JSON.parse(written as string);
    expect(parsed).toEqual({
      type: "user_message",
      data: { content: "follow up" },
    });
  });

  it("resets resultObserved after new turn", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true },
    });
    expect(rt.state.resultObserved).toBe(true);

    rt.cancelInputClose();
    const sent = rt.sendUserTurn(
      child, "next turn", "take_2",
    );
    expect(sent).toBe(true);
    expect(rt.state.resultObserved).toBe(false);
    expect(rt.state.exitReason).toBeNull();

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true },
    });
    expect(rt.state.resultObserved).toBe(true);
  });

  it("times out when a follow-up turn hangs", () => {
    const rt = createSessionRuntime(
      makeConfig({ watchdogTimeoutMs: 5_000 }),
    );
    const child = makeChild();
    rt.wireStdout(child);

    emitLine(child, {
      type: "session.task_complete",
      data: { success: true },
    });
    expect(rt.state.exitReason).toBe(
      "turn_ended",
    );

    rt.cancelInputClose();
    const sent = rt.sendUserTurn(
      child, "next turn", "take_2",
    );
    expect(sent).toBe(true);
    expect(rt.state.resultObserved).toBe(false);
    expect(rt.state.exitReason).toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(rt.state.exitReason).toBe("timeout");
  });
});

// ── Abort ────────────────────────────────────────────

describe("copilot interactive: abort", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("dispose clears watchdog and closes stdin", () => {
    const rt = createSessionRuntime(makeConfig());
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
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    rt.wireStdout(child);
    rt.dispose();

    const sent = rt.sendUserTurn(
      child, "too late", "manual",
    );
    expect(sent).toBe(false);
  });
});

// ── AskUser auto-response ────────────────────────────

describe("copilot interactive: AskUser auto", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("auto-answers AskUser in interactive mode", () => {
    const rt = createSessionRuntime(makeConfig());
    const child = makeChild();
    const writeSpy = vi.spyOn(child.stdin!, "write");
    rt.wireStdout(child);

    emitLine(child, {
      type: "user_input.requested",
      data: {
        toolCallId: "tool-1",
        question: "Continue?",
        choices: ["Yes", "No"],
      },
    });

    const writes = writeSpy.mock.calls;
    expect(writes.length).toBeGreaterThan(0);

    const lastWrite = writes[writes.length - 1][0];
    const parsed = JSON.parse(lastWrite as string);
    expect(parsed.type).toBe("user_message");
    expect(parsed.data.content).toContain(
      "auto-response",
    );
  });
});
