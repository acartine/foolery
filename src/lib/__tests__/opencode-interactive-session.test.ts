/**
 * Tests for interactive OpenCode sessions via the
 * shared session runtime + OpenCodeHttpSession.
 *
 * Covers: successful completion, watchdog timeout,
 * retry/abort, follow-up turn delivery, and HTTP
 * server URL discovery.
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
  createOpenCodeHttpSession,
  type OpenCodeHttpSession,
} from "@/lib/opencode-http-session";

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
    import("@/lib/interaction-logger")
      .InteractionLog;
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

/**
 * Create a runtime config wired to an
 * OpenCodeHttpSession. The onEvent callback
 * is connected to runtime.injectLine after
 * the runtime is created.
 */
function makeConfigWithHttp(
  overrides?: Partial<SessionRuntimeConfig>,
): {
  config: SessionRuntimeConfig;
  httpSession: OpenCodeHttpSession;
} {
  const caps = resolveCapabilities(
    "opencode", true,
  );
  const onEventCbs: Array<
    (line: string) => void
  > = [];
  const httpSession = createOpenCodeHttpSession(
    (line) => {
      for (const cb of onEventCbs) cb(line);
    },
    vi.fn(),
  );

  const config: SessionRuntimeConfig = {
    id: "opencode-test",
    dialect: "opencode",
    capabilities: caps,
    watchdogTimeoutMs: DEFAULT_WATCHDOG_TIMEOUT_MS,
    normalizeEvent:
      createLineNormalizer("opencode"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    httpSession,
    ...overrides,
  };

  // Deferred wiring: after runtime is created,
  // wire onEvent → runtime.injectLine
  const origConfig = config;
  const patchInjectLine = (
    rt: ReturnType<typeof createSessionRuntime>,
    child: ChildProcess,
  ) => {
    onEventCbs.push((line) => {
      rt.injectLine(child, line);
    });
  };

  return {
    config: origConfig,
    httpSession,
    // @ts-expect-error: injected helper
    patchInjectLine,
  };
}

function emitStdoutLine(
  child: ChildProcess,
  text: string,
): void {
  child.stdout!.emit(
    "data",
    Buffer.from(text + "\n"),
  );
}

// ── HTTP server URL discovery ───────────────────────

describe("opencode interactive: URL discovery", () => {
  it("parses server URL from stdout", () => {
    const { httpSession } = makeConfigWithHttp();
    expect(httpSession.ready).toBe(false);
    expect(httpSession.serverUrl).toBeNull();

    const found = httpSession.processStdoutLine(
      "opencode server listening on " +
      "http://127.0.0.1:4096",
    );
    expect(found).toBe(true);
    expect(httpSession.ready).toBe(true);
    expect(httpSession.serverUrl).toBe(
      "http://127.0.0.1:4096",
    );
  });

  it("ignores non-URL lines", () => {
    const { httpSession } = makeConfigWithHttp();
    const found = httpSession.processStdoutLine(
      "INFO 2026-04-03 loading config",
    );
    expect(found).toBe(false);
    expect(httpSession.ready).toBe(false);
  });

  it("runtime routes stdout to httpSession", () => {
    const { config, httpSession } =
      makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    emitStdoutLine(
      child,
      "opencode server listening on " +
      "http://127.0.0.1:5555",
    );
    expect(httpSession.ready).toBe(true);
    expect(httpSession.serverUrl).toBe(
      "http://127.0.0.1:5555",
    );
  });

  it("non-URL stdout pushed as terminal event", () => {
    const pushEvent = vi.fn();
    const { config } =
      makeConfigWithHttp({ pushEvent });
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    emitStdoutLine(child, "INFO loading config");
    expect(pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stdout",
        data: expect.stringContaining(
          "INFO loading config",
        ),
      }),
    );
  });
});

// ── Successful completion via injected events ───────

describe("opencode interactive: completion", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("detects result from injected step_finish", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    // Inject events as if from HTTP response
    rt.injectLine(child, JSON.stringify({
      type: "text",
      part: { text: "Done" },
    }));
    expect(rt.state.resultObserved).toBe(false);

    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "stop" },
    }));
    expect(rt.state.resultObserved).toBe(true);
    expect(rt.state.exitReason).toBe(
      "turn_ended",
    );
  });

  it("detects error result from step_finish", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "error" },
    }));
    expect(rt.state.resultObserved).toBe(true);
    expect(
      rt.state.lastNormalizedEvent?.is_error,
    ).toBe(true);
  });

  it("schedules input close after result", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);

    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "stop" },
    }));
    expect(endSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(endSpy).toHaveBeenCalledOnce();
  });
});

// ── Watchdog timeout ────────────────────────────────

describe("opencode interactive: watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("terminates after the shared 10 minute inactivity timeout", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);
    expect(rt.state.watchdogTimer).not.toBeNull();

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS,
    );
    expect(rt.state.exitReason).toBe("timeout");
    expect(rt.state.watchdogTimer).toBeNull();
  });

  it("resets watchdog on injected events", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS - 5_000,
    );
    rt.injectLine(child, JSON.stringify({
      type: "text",
      part: { text: "progress" },
    }));

    vi.advanceTimersByTime(
      DEFAULT_WATCHDOG_TIMEOUT_MS - 5_000,
    );
    expect(rt.state.exitReason).toBeNull();

    vi.advanceTimersByTime(6_000);
    expect(rt.state.exitReason).toBe("timeout");
  });

  it(
    "fires on silence even after result observed " +
    "(canonical liveness rule)",
    () => {
      const killSpy = vi.spyOn(process, "kill")
        .mockImplementation(() => true);
      const warnSpy = vi.spyOn(console, "warn")
        .mockImplementation(() => { /* quiet */ });
      const { config } = makeConfigWithHttp();
      const rt = createSessionRuntime(config);
      const child = makeChild();
      rt.wireStdout(child);

      rt.injectLine(child, JSON.stringify({
        type: "step_finish",
        part: { reason: "stop" },
      }));
      expect(rt.state.resultObserved).toBe(true);

      // Result event reset the watchdog; the child
      // stays OS-live, so a full window of silence
      // must still trip the watchdog.
      vi.advanceTimersByTime(
        DEFAULT_WATCHDOG_TIMEOUT_MS + 1,
      );
      expect(rt.state.exitReason).toBe("timeout");
      expect(killSpy).toHaveBeenCalled();
      killSpy.mockRestore();
      warnSpy.mockRestore();
    },
  );
});

// ── Follow-up turn / retry ──────────────────────────

describe("opencode interactive: follow-up", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends follow-up via onTurnEnded callback", () => {
    const onTurnEnded = vi.fn(() => true);
    const { config } =
      makeConfigWithHttp({ onTurnEnded });
    const rt = createSessionRuntime(config);
    const child = makeChild();
    const endSpy = vi.spyOn(child.stdin!, "end");
    rt.wireStdout(child);

    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "stop" },
    }));
    expect(onTurnEnded).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("resets resultObserved after new turn", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "stop" },
    }));
    expect(rt.state.resultObserved).toBe(true);

    rt.cancelInputClose();
    const sent = rt.sendUserTurn(
      child, "next turn", "take_2",
    );
    expect(sent).toBe(true);
    expect(rt.state.resultObserved).toBe(false);
    expect(rt.state.exitReason).toBeNull();
  });

  it("times out when a follow-up turn hangs", () => {
    const { config } =
      makeConfigWithHttp({ watchdogTimeoutMs: 5_000 });
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);

    rt.injectLine(child, JSON.stringify({
      type: "step_finish",
      part: { reason: "stop" },
    }));
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

// ── Abort ───────────────────────────────────────────

describe("opencode interactive: abort", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("dispose clears watchdog and closes", () => {
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
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
    const { config } = makeConfigWithHttp();
    const rt = createSessionRuntime(config);
    const child = makeChild();
    rt.wireStdout(child);
    rt.dispose();

    const sent = rt.sendUserTurn(
      child, "too late", "manual",
    );
    expect(sent).toBe(false);
  });
});

// ── OpenCodeHttpSession unit tests ──────────────────

describe("OpenCodeHttpSession", () => {
  it("queues turn before server URL discovered", () => {
    const onEvent = vi.fn();
    const session = createOpenCodeHttpSession(
      onEvent, vi.fn(),
    );
    const child = makeChild();

    const sent = session.startTurn(
      child, "initial prompt",
    );
    expect(sent).toBe(true);
    expect(session.ready).toBe(false);
  });

  it("interruptTurn clears pending", () => {
    const onEvent = vi.fn();
    const session = createOpenCodeHttpSession(
      onEvent, vi.fn(),
    );
    const child = makeChild();

    session.startTurn(child, "initial prompt");
    const result = session.interruptTurn(child);
    expect(result).toBe(true);
  });

  it("startTurn returns true when ready", () => {
    const onEvent = vi.fn();
    const session = createOpenCodeHttpSession(
      onEvent, vi.fn(),
    );

    session.processStdoutLine(
      "opencode server listening on " +
      "http://127.0.0.1:9999",
    );
    expect(session.ready).toBe(true);

    const child = makeChild();
    // startTurn will fire async HTTP — we just
    // verify it returns true synchronously
    const sent = session.startTurn(
      child, "hello",
    );
    expect(sent).toBe(true);
  });
});
