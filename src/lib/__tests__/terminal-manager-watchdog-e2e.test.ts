/**
 * End-to-end observability canary (foolery-f8ae).
 *
 * This test locks the FULL chain of side effects that
 * operators depend on to diagnose a watchdog-induced
 * take-loop child termination (the 557d silent-kill bug):
 *
 *   1. No normalized events after arming the watchdog.
 *   2. Fake timers advance past watchdogTimeoutMs.
 *   3. The runtime emits a `watchdog_fired` lifecycle
 *      event (from foolery-2782).
 *   4. `console.warn` is called with the
 *      `[terminal-manager] [watchdog]` tag
 *      (from foolery-2782).
 *   5. `terminateProcessGroup` is invoked (observed via
 *      `process.kill(-pid, "SIGTERM")`).
 *   6. The mock child's `close` handler fires with our
 *      SIGTERM signal.
 *   7. The enriched child_close console log line
 *      (from foolery-e750) contains `signal=`,
 *      `exitReason=timeout`, `msSinceLastStdout=`,
 *      and `lastEventType=`.
 *   8. `recordTakeLoopLifecycle` is called with
 *      `event="child_close"` carrying the matching
 *      enriched payload fields.
 *
 * NOTE (foolery-062f, shipped 8929ae99): requires the
 * `[terminate-process-group] reason=watchdog_timeout`
 * warn line. This assertion is now active.
 *
 * INTENT: this test is explicitly a fake-fix canary. If
 * any of the above log lines or events is silenced or
 * dropped in a future refactor, the corresponding
 * assertion below MUST fail with a named, specific
 * message. Do not silence these logs — fix the logging.
 */
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock take-loop lifecycle so we can inspect payload
// without requiring the full take-loop state machine
// or interaction log. The rest of the chain
// (createSessionRuntime, wireTakeChildClose, the
// real console.log line, real process.kill) runs
// unmocked on purpose.
const recordTakeLoopLifecycleMock = vi.fn();
vi.mock("@/lib/terminal-manager-take-lifecycle", () => ({
  recordTakeLoopLifecycle: (...args: unknown[]) =>
    recordTakeLoopLifecycleMock(...args),
  runtimeAgentPatch: vi.fn(() => ({})),
  runtimePreview: vi.fn((s: string) => s),
}));

// Prevent the take-iteration follow-on machinery from
// firing during the test; we only care about the close
// handler itself.
const handleTakeIterationCloseMock =
  vi.fn<(...args: unknown[]) => Promise<void>>(
    async () => undefined,
  );
vi.mock("@/lib/terminal-manager-take-iteration", () => ({
  handleTakeIterationClose: (...args: unknown[]) =>
    handleTakeIterationCloseMock(...args),
}));

import {
  createSessionRuntime,
  type AgentSessionRuntime,
} from "@/lib/agent-session-runtime";
import {
  resolveCapabilities,
} from "@/lib/agent-session-capabilities";
import { createLineNormalizer } from "@/lib/agent-adapter";
import {
  wireTakeChildClose,
} from "@/lib/terminal-manager-take-child-helpers";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";

// foolery-062f has shipped, so the
// [terminate-process-group] warn line is now required.
const REQUIRE_TERMINATE_PROCESS_GROUP_LOG = true;

// ── Fixtures ─────────────────────────────────────────

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    writable: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
  pid: number;
};

function makeMockChild(pid = 77777): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writable: true,
    write: vi.fn(() => true),
    end: vi.fn(),
  };
  child.kill = vi.fn(() => true);
  child.pid = pid;
  return child;
}

function makeInteractionLog() {
  return {
    filePath: undefined as string | undefined,
    logStdout: vi.fn(),
    logStderr: vi.fn(),
    logResponse: vi.fn(),
    logPrompt: vi.fn(),
    logEnd: vi.fn(),
    logBeatState: vi.fn(),
    logLifecycle: vi.fn(),
  } as unknown as
    import("@/lib/interaction-logger").InteractionLog;
}

function makeTakeLoopContext(
  sessionId: string,
  beatId: string,
  child: MockChild,
  finishSession: (code: number) => void,
): TakeLoopContext {
  const emitter = new EventEmitter();
  return {
    id: sessionId,
    beatId,
    beat: { id: beatId } as unknown as
      TakeLoopContext["beat"],
    repoPath: undefined,
    resolvedRepoPath: "/tmp/repo",
    cwd: "/tmp/repo",
    interactiveSessionTimeoutMinutes: 0,
    memoryManagerType: "knots",
    workflowsById: new Map(),
    fallbackWorkflow: {} as unknown as
      TakeLoopContext["fallbackWorkflow"],
    agent: {
      command: "claude", label: "Claude",
    } as unknown as TakeLoopContext["agent"],
    agentInfo: {
      agentName: "Claude",
    } as unknown as TakeLoopContext["agentInfo"],
    entry: {
      session: {} as unknown as
        import("@/lib/types").TerminalSession,
      process: child as unknown as ChildProcess,
      emitter,
      buffer: [],
      interactionLog: makeInteractionLog(),
    } as unknown as TakeLoopContext["entry"],
    session: {
      id: sessionId,
    } as unknown as TakeLoopContext["session"],
    interactionLog: makeInteractionLog(),
    emitter,
    pushEvent: vi.fn(),
    finishSession,
    sessionAborted: () => false,
    knotsLeaseTerminationStarted: { value: false },
    takeIteration: { value: 1 },
    claimsPerQueueType: new Map(),
    lastAgentPerQueueType: new Map(),
    failedAgentsPerQueueType: new Map(),
    followUpAttempts: { count: 0, lastState: null },
  };
}

function findLogLine(
  logSpy: ReturnType<typeof vi.spyOn>,
  predicate: (line: string) => boolean,
): string | undefined {
  return logSpy.mock.calls
    .map((args: unknown[]) =>
      args.map((a) => String(a)).join(" "),
    )
    .find(predicate);
}

function findWarnCall(
  warnSpy: ReturnType<typeof vi.spyOn>,
  needle: string,
): unknown[] | undefined {
  return warnSpy.mock.calls.find(
    (call: unknown[]) =>
      typeof call[0] === "string" &&
      (call[0] as string).includes(needle),
  );
}

// ── End-to-end harness ───────────────────────────────

interface HarnessHandles {
  runtime: AgentSessionRuntime;
  child: MockChild;
  warnSpy: ReturnType<typeof vi.spyOn>;
  logSpy: ReturnType<typeof vi.spyOn>;
  killSpy: ReturnType<typeof vi.spyOn>;
  lifecycleEvents: Array<
    import(
      "@/lib/agent-session-runtime"
    ).SessionRuntimeLifecycleEvent
  >;
}

function armHarness(watchdogTimeoutMs: number): HarnessHandles {
  const warnSpy = vi.spyOn(console, "warn")
    .mockImplementation(() => undefined);
  const logSpy = vi.spyOn(console, "log")
    .mockImplementation(() => undefined);
  const killSpy = vi.spyOn(process, "kill")
    .mockImplementation(() => true);

  const child = makeMockChild(77777);
  const lifecycleEvents: Array<
    import(
      "@/lib/agent-session-runtime"
    ).SessionRuntimeLifecycleEvent
  > = [];
  const runtime = createSessionRuntime({
    id: "e2e-session",
    dialect: "claude",
    capabilities: resolveCapabilities("claude"),
    watchdogTimeoutMs,
    normalizeEvent: createLineNormalizer("claude"),
    pushEvent: vi.fn(),
    interactionLog: makeInteractionLog(),
    beatIds: ["beat-e2e"],
    onLifecycleEvent: (e) => { lifecycleEvents.push(e); },
  });

  const finishSessionSpy = vi.fn();
  const ctx = makeTakeLoopContext(
    "e2e-session", "beat-e2e", child,
    finishSessionSpy,
  );

  runtime.wireStdout(child as unknown as ChildProcess);
  runtime.wireStderr(child as unknown as ChildProcess);
  wireTakeChildClose(
    ctx,
    child as unknown as ChildProcess,
    runtime,
    {
      command: "claude", label: "Claude",
    } as unknown as Parameters<
      typeof wireTakeChildClose
    >[3],
    "implementation",
  );

  return { runtime, child, warnSpy, logSpy, killSpy, lifecycleEvents };
}

// ── Shared lifecycle hooks ────────────────────────────

function installTestLifecycle(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    recordTakeLoopLifecycleMock.mockReset();
    handleTakeIterationCloseMock.mockReset();
    handleTakeIterationCloseMock.mockResolvedValue(
      undefined,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}

// ── Tests (watchdog firing side of the chain) ─────────

describe("e2e: watchdog fires -> SIGTERM", () => {
  installTestLifecycle();

  it("emits watchdog_fired lifecycle event", () => {
    const h = armHarness(50);
    vi.advanceTimersByTime(60);
    const fired = h.lifecycleEvents.find(
      (e) => e.type === "watchdog_fired",
    );
    expect(fired).toBeDefined();
    if (fired && fired.type === "watchdog_fired") {
      expect(fired.timeoutMs).toBe(50);
      expect(typeof fired.msSinceLastEvent)
        .toBe("number");
      expect(fired.lastEventType).toBeUndefined();
    }
  });

  it(
    "logs [terminal-manager] [watchdog] console.warn",
    () => {
      const h = armHarness(50);
      vi.advanceTimersByTime(60);
      const warnCall = findWarnCall(
        h.warnSpy,
        "[terminal-manager] [watchdog]",
      );
      expect(warnCall).toBeDefined();
      const msg = warnCall?.[0] as string;
      expect(msg).toContain("timeout_fired");
      expect(msg).toContain("pid=77777");
      expect(msg).toContain("timeoutMs=50");
      expect(msg).toContain("reason=timeout");
    },
  );

  it("invokes terminateProcessGroup via process.kill", () => {
    const h = armHarness(50);
    vi.advanceTimersByTime(60);
    expect(h.killSpy).toHaveBeenCalledWith(
      -77777, "SIGTERM",
    );
  });

  it("warns BEFORE issuing SIGTERM", () => {
    const h = armHarness(50);
    vi.advanceTimersByTime(60);
    const warnIdx =
      h.warnSpy.mock.invocationCallOrder
        .find((_order: number, i: number) => {
          const arg = h.warnSpy.mock.calls[i]?.[0];
          return (
            typeof arg === "string" &&
            arg.includes("[watchdog]")
          );
        });
    const killIdx =
      h.killSpy.mock.invocationCallOrder[0];
    expect(warnIdx).toBeDefined();
    expect(killIdx).toBeDefined();
    expect(warnIdx!).toBeLessThan(killIdx!);
  });

  it(
    "emits [terminate-process-group] warn " +
    "with reason=watchdog_timeout (foolery-062f)",
    () => {
      const h = armHarness(50);
      vi.advanceTimersByTime(60);
      const warnCall = findWarnCall(
        h.warnSpy,
        "[terminate-process-group]",
      );
      expect(REQUIRE_TERMINATE_PROCESS_GROUP_LOG)
        .toBe(true);
      expect(warnCall).toBeDefined();
      const msg = warnCall?.[0] as string;
      expect(msg).toContain(
        "reason=watchdog_timeout",
      );
    },
  );
});

// ── Tests (close handler side of the chain) ───────────

describe("e2e: child_close enrichment after SIGTERM", () => {
  installTestLifecycle();

  it(
    "emits enriched child_close console.log: " +
    "signal, exitReason=timeout, msSinceLastStdout, " +
    "lastEventType (the 557d observability chain)",
    () => {
      const h = armHarness(50);
      // Simulate the 557d pattern: child emits SOME
      // stdout (a non-normalized line) then goes silent.
      // This pins msSinceLastStdout to a real number,
      // which is the critical signal operators need to
      // distinguish a SIGTERM'd silent child from a
      // clean exit.
      h.child.stdout.emit(
        "data", Buffer.from("initial chatter\n"),
      );
      vi.advanceTimersByTime(60);
      // Simulate the kernel actually delivering SIGTERM
      // back to us as a close event with matching signal.
      h.child.emit("close", 0, "SIGTERM");
      const line = findLogLine(
        h.logSpy,
        (l) =>
          l.includes("child close:") &&
          l.includes("take-loop"),
      );
      expect(line).toBeDefined();
      expect(line).toContain("signal=SIGTERM");
      expect(line).toContain("exitReason=timeout");
      expect(line).toMatch(/msSinceLastStdout=\d+/);
      expect(line).toContain("lastEventType=null");
    },
  );

  it(
    "records child_close lifecycle with matching " +
    "enrichment fields",
    () => {
      const h = armHarness(50);
      h.child.stdout.emit(
        "data", Buffer.from("initial chatter\n"),
      );
      vi.advanceTimersByTime(60);
      h.child.emit("close", 0, "SIGTERM");
      const closeCall =
        recordTakeLoopLifecycleMock.mock.calls
          .find(
            (args: unknown[]) =>
              args[1] === "child_close",
          );
      expect(closeCall).toBeDefined();
      const payload =
        closeCall?.[2] as Record<string, unknown>;
      expect(payload.childSignal).toBe("SIGTERM");
      expect(payload.childExitCode).toBe(0);
      expect(payload.exitReason).toBe("timeout");
      expect(typeof payload.msSinceLastStdout)
        .toBe("number");
      expect(payload).toHaveProperty("lastEventType");
    },
  );
});
