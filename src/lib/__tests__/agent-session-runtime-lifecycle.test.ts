import {
  describe, it, expect, vi,
  beforeEach, afterEach,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createSessionRuntime,
  terminateProcessGroup,
  type SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";
import type {
  SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";

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

// ── Gemini stdout ──────────────────────────────────────

describe("runtime: gemini stdout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("normalizes message/result events", () => {
    const rt = createSessionRuntime(
      makeConfig("gemini"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "init",
        session_id: "s1",
        model: "gemini-3",
      }) + "\n"),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "message",
        role: "assistant",
        content: "Hello",
        delta: true,
      }) + "\n"),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        status: "success",
        stats: { total_tokens: 100 },
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
  });

  it("treats non-success as error", () => {
    const rt = createSessionRuntime(
      makeConfig("gemini"),
    );
    const child = makeChild(false);
    child.stdout = new PassThrough();
    rt.wireStdout(child);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        status: "error",
        stats: {},
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
    expect(
      rt.state.lastNormalizedEvent?.is_error,
    ).toBe(true);
  });
});

// ── onTurnEnded callback ───────────────────────────────

describe("runtime: onTurnEnded callback", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("prevents close when returns true", () => {
    const config = makeConfig("claude", {
      onTurnEnded: () => true,
    });
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        result: "done",
        is_error: false,
      }) + "\n"),
    );
    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("schedules close when returns false", () => {
    const config = makeConfig("claude", {
      onTurnEnded: () => false,
    });
    const rt = createSessionRuntime(config);
    const child = makeChild(true);
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        result: "done",
        is_error: false,
      }) + "\n"),
    );
    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

describe("runtime: lifecycle callbacks", () => {
  it("emits prompt delivery events for stdio turns", () => {
    const events: SessionRuntimeLifecycleEvent[] = [];
    const rt = createSessionRuntime(
      makeConfig("claude", {
        onLifecycleEvent: (event) => {
          events.push(event);
        },
      }),
    );
    const child = makeChild(true);

    expect(
      rt.sendUserTurn(child, "instrument this", "manual"),
    ).toBe(true);
    expect(events).toContainEqual({
      type: "prompt_delivery_attempted",
      transport: "stdio",
    });
    expect(events).toContainEqual({
      type: "prompt_delivery_succeeded",
      transport: "stdio",
    });
  });

  it("emits observation events for response and result lines", () => {
    const events: SessionRuntimeLifecycleEvent[] = [];
    const rt = createSessionRuntime(
      makeConfig("claude", {
        onLifecycleEvent: (event) => {
          events.push(event);
        },
      }),
    );
    const child = makeChild(true);

    rt.wireStdout(child);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        result: "done",
        is_error: false,
      }) + "\n"),
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "stdout_observed",
        }),
        expect.objectContaining({
          type: "response_logged",
        }),
        expect.objectContaining({
          type: "normalized_event_observed",
          eventType: "result",
        }),
        expect.objectContaining({
          type: "turn_ended",
          eventType: "result",
          isError: false,
        }),
      ]),
    );
  });
});

// ── Buffer & raw fallback ──────────────────────────────

describe("runtime: flushLineBuffer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("processes partial JSON in buffer", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    const partial = JSON.stringify({
      type: "result",
      result: "buffered",
      is_error: false,
    });
    child.stdout!.emit(
      "data", Buffer.from(partial),
    );
    expect(rt.state.resultObserved).toBe(false);
    rt.flushLineBuffer(child);
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.lineBuffer).toBe("");
  });
});

describe("runtime: line buffering", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("handles chunked data across calls", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    const full = JSON.stringify({
      type: "result",
      result: "done",
      is_error: false,
    });
    const half = Math.floor(full.length / 2);
    child.stdout!.emit(
      "data", Buffer.from(full.slice(0, half)),
    );
    expect(rt.state.resultObserved).toBe(false);
    child.stdout!.emit(
      "data",
      Buffer.from(full.slice(half) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
  });
});

describe("runtime: stderr and raw stdout", () => {
  it("pushes stderr events", () => {
    const pushEvent = vi.fn();
    const rt = createSessionRuntime(
      makeConfig("claude", { pushEvent }),
    );
    const child = makeChild(true);
    rt.wireStderr(child);
    child.stderr!.emit(
      "data", Buffer.from("error output"),
    );
    const stderrEvts = pushEvent.mock.calls
      .filter(
        (c: unknown[]) =>
          (c[0] as { type: string }).type ===
          "stderr",
      );
    expect(stderrEvts).toHaveLength(1);
    expect(
      (stderrEvts[0][0] as { data: string }).data,
    ).toBe("error output");
  });

  it("pushes non-JSON as raw stdout", () => {
    const pushEvent = vi.fn();
    const rt = createSessionRuntime(
      makeConfig("claude", { pushEvent }),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    child.stdout!.emit(
      "data", Buffer.from("not json\n"),
    );
    const stdoutEvts = pushEvent.mock.calls
      .filter(
        (c: unknown[]) =>
          (c[0] as { type: string }).type ===
          "stdout",
      );
    expect(stdoutEvts.length).toBeGreaterThan(0);
    expect(
      (stdoutEvts[0][0] as { data: string }).data,
    ).toBe("not json\n");
  });
});

// ── Watchdog ───────────────────────────────────────────

describe("runtime: watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("terminates after inactivity timeout", () => {
    const rt = createSessionRuntime(
      makeConfig("claude", {
        watchdogTimeoutMs: 30_000,
      }),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).not.toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(rt.state.exitReason).toBe("timeout");
    expect(rt.state.watchdogTimer).toBeNull();
  });

  it("resets on event activity", () => {
    const rt = createSessionRuntime(
      makeConfig("claude", {
        watchdogTimeoutMs: 10_000,
      }),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    vi.advanceTimersByTime(8_000);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text" }] },
      }) + "\n"),
    );
    vi.advanceTimersByTime(8_000);
    expect(rt.state.exitReason).toBeNull();
    vi.advanceTimersByTime(3_000);
    expect(rt.state.exitReason).toBe("timeout");
  });

  it("does not fire when watchdog is null", () => {
    const rt = createSessionRuntime(
      makeConfig("claude"),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(rt.state.exitReason).toBeNull();
  });

  it("is cleared by dispose", () => {
    const rt = createSessionRuntime(
      makeConfig("claude", {
        watchdogTimeoutMs: 10_000,
      }),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).not.toBeNull();
    rt.dispose();
    expect(rt.state.watchdogTimer).toBeNull();
    vi.advanceTimersByTime(20_000);
    expect(rt.state.exitReason).toBeNull();
  });

  it("skips termination after result", () => {
    const rt = createSessionRuntime(
      makeConfig("claude", {
        watchdogTimeoutMs: 5_000,
      }),
    );
    const child = makeChild(true);
    rt.wireStdout(child);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "result",
        result: "ok",
        is_error: false,
      }) + "\n"),
    );
    expect(rt.state.resultObserved).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(rt.state.exitReason).toBe(
      "turn_ended",
    );
  });
});

// ── terminateProcessGroup ──────────────────────────────

describe("terminateProcessGroup", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends SIGTERM then SIGKILL", () => {
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementation(() => true);
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => {});
    const child = makeChild(false);

    terminateProcessGroup(child, "test_reason", 1000);
    expect(killSpy).toHaveBeenCalledWith(
      -12345, "SIGTERM",
    );
    vi.advanceTimersByTime(1000);
    expect(killSpy).toHaveBeenCalledWith(
      -12345, "SIGKILL",
    );
    killSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("falls back to child.kill", () => {
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementation(() => {
        throw new Error("ESRCH");
      });
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => {});
    const child = makeChild(false);

    terminateProcessGroup(child, "test_reason", 500);
    expect(child.kill).toHaveBeenCalledWith(
      "SIGTERM",
    );
    vi.advanceTimersByTime(500);
    expect(child.kill).toHaveBeenCalledWith(
      "SIGKILL",
    );
    killSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs at entry with pid, reason, and tag", () => {
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementation(() => true);
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => {});
    const child = makeChild(false);

    terminateProcessGroup(
      child, "watchdog_timeout", 1000,
    );

    const entryCall = warnSpy.mock.calls[0]?.[0] as string;
    expect(entryCall).toContain(
      "[terminate-process-group]",
    );
    expect(entryCall).toContain(
      "reason=watchdog_timeout",
    );
    expect(entryCall).toContain("pid=12345");
    expect(entryCall).toContain("delayMs=1000");

    killSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs SIGKILL branch when forced after delay", () => {
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementation(() => true);
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => {});
    const child = makeChild(false);

    terminateProcessGroup(
      child, "external_abort", 750,
    );
    warnSpy.mockClear();
    vi.advanceTimersByTime(750);

    const sigkillCall =
      warnSpy.mock.calls[0]?.[0] as string;
    expect(sigkillCall).toContain(
      "[terminate-process-group]",
    );
    expect(sigkillCall).toContain("pid=12345");
    expect(sigkillCall).toContain(
      "reason=external_abort",
    );
    expect(sigkillCall).toContain("signal=SIGKILL");
    expect(sigkillCall).toContain("750ms");

    killSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
