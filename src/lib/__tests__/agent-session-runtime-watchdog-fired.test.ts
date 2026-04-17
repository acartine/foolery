import {
  describe, it, expect, vi,
  beforeEach, afterEach,
  type MockInstance,
} from "vitest";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import {
  createSessionRuntime,
  type SessionRuntimeConfig,
  type SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";

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

function makeChild(): ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  return {
    stdout, stderr, stdin,
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

function makeConfig(
  overrides?: Partial<SessionRuntimeConfig>,
): SessionRuntimeConfig {
  return {
    id: "test-session",
    dialect: "claude",
    capabilities: resolveCapabilities("claude"),
    watchdogTimeoutMs: null,
    normalizeEvent: createLineNormalizer("claude"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-1"],
    ...overrides,
  };
}

function assertFiredEvent(
  events: SessionRuntimeLifecycleEvent[],
): void {
  const fired = events.find(
    (e) => e.type === "watchdog_fired",
  );
  expect(fired).toBeDefined();
  if (fired && fired.type === "watchdog_fired") {
    expect(fired.timeoutMs).toBe(10_000);
    expect(fired.msSinceLastEvent).toBe(10_000);
    expect(fired.lastEventType).toBe("assistant");
  }
}

type WarnSpy = MockInstance<
  (...args: unknown[]) => void
>;

function assertWarnMessage(warnSpy: WarnSpy): void {
  const warnCall = warnSpy.mock.calls.find(
    (call: unknown[]) =>
      typeof call[0] === "string" &&
      (call[0] as string).includes(
        "[terminal-manager] [watchdog]",
      ),
  );
  expect(warnCall).toBeDefined();
  const warnMsg = warnCall?.[0] as string;
  expect(warnMsg).toContain("timeout_fired");
  expect(warnMsg).toContain("pid=12345");
  expect(warnMsg).toContain("timeoutMs=10000");
  expect(warnMsg).toContain("reason=timeout");
  expect(warnMsg).toContain("lastEventType=assistant");
}

// ── Tests ──────────────────────────────────────────────

describe("runtime: watchdog_fired lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("warns and emits event before SIGTERM", () => {
    const events: SessionRuntimeLifecycleEvent[] = [];
    const warnSpy = vi.spyOn(console, "warn")
      .mockImplementation(() => { /* quiet */ });
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementation(() => true);
    const rt = createSessionRuntime(
      makeConfig({
        watchdogTimeoutMs: 10_000,
        onLifecycleEvent: (event) => {
          events.push(event);
        },
      }),
    );
    const child = makeChild();
    rt.wireStdout(child);

    vi.advanceTimersByTime(2_000);
    child.stdout!.emit(
      "data",
      Buffer.from(JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text" }] },
      }) + "\n"),
    );

    events.length = 0;
    vi.advanceTimersByTime(10_000);

    expect(rt.state.exitReason).toBe("timeout");
    assertFiredEvent(events);
    assertWarnMessage(warnSpy);

    expect(killSpy).toHaveBeenCalledWith(
      -12345, "SIGTERM",
    );
    const warnInvocation =
      warnSpy.mock.invocationCallOrder[0];
    const killInvocation =
      killSpy.mock.invocationCallOrder[0];
    expect(warnInvocation)
      .toBeLessThan(killInvocation);

    warnSpy.mockRestore();
    killSpy.mockRestore();
  });
});
