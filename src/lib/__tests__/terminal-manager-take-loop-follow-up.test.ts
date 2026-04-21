/**
 * foolery-6881 regression canaries for the take-loop
 * in-session follow-up. See `terminal-manager-take-
 * follow-up.ts` for the handler implementation.
 *
 * Why these tests exist:
 *   - The user personally asserted this bug was
 *     "definitely 100% fixed" TWICE before. Both times
 *     the take-loop runtime was missing `onTurnEnded`.
 *   - foolery-a401 wired the transport-agnostic signal.
 *     This knot wires the take-loop CONSUMER of that
 *     signal. If a future refactor forgets to pass
 *     `onTurnEnded` to `createSessionRuntime` in the
 *     take-loop, Test D below will fail.
 *
 * If any of these tests regress, do NOT patch the test.
 * Audit whether someone removed the `onTurnEnded` wiring
 * from `createTakeRuntimeBundle` (or equivalent factory).
 * That is the exact fake-fix pattern this knot eradicates.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  buildTakeLoopFollowUpPrompt,
  handleTakeLoopTurnEnded,
} from "@/lib/terminal-manager-take-follow-up";
import type { TakeLoopContext } from "@/lib/terminal-manager-take-loop";
import type {
  AgentSessionRuntime,
} from "@/lib/agent-session-runtime";

// ── Mocks ────────────────────────────────────────────

const backendGet = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({ get: backendGet }),
}));

// ── Fixtures ─────────────────────────────────────────

function makeCtx(
  overrides: Partial<TakeLoopContext> = {},
): TakeLoopContext {
  const pushEvent = vi.fn();
  const fallbackWorkflow = {
    id: "default", label: "default",
    states: ["open", "planning", "shipped"],
    terminalStates: ["shipped"],
    initialState: "open",
    actionStates: ["planning"],
    queueStates: [],
    queueActions: {},
  } as unknown as TakeLoopContext["fallbackWorkflow"];
  return {
    id: "take-test",
    beatId: "beat-6881",
    beat: { id: "beat-6881", state: "open" } as
      unknown as TakeLoopContext["beat"],
    repoPath: undefined,
    resolvedRepoPath: "/tmp/foolery-test",
    cwd: "/tmp/foolery-test",
    interactiveSessionTimeoutMinutes: 0,
    memoryManagerType: "knots",
    workflowsById: new Map(),
    fallbackWorkflow,
    agent: {
      command: "claude", label: "Claude",
      agentId: "claude", model: "sonnet",
      version: "1",
    } as unknown as TakeLoopContext["agent"],
    agentInfo: {
      agentName: "Claude", agentId: "claude",
      agentKind: "cli",
    } as unknown as TakeLoopContext["agentInfo"],
    entry: {
      takeLoopLifecycle: new Map(),
    } as unknown as TakeLoopContext["entry"],
    session: {} as TakeLoopContext["session"],
    interactionLog: {
      logLifecycle: vi.fn(), logPrompt: vi.fn(),
      logStdout: vi.fn(), logStderr: vi.fn(),
      logResponse: vi.fn(), logBeatState: vi.fn(),
      logEnd: vi.fn(),
    } as unknown as TakeLoopContext["interactionLog"],
    emitter: {} as TakeLoopContext["emitter"],
    pushEvent,
    finishSession: vi.fn(),
    sessionAborted: () => false,
    knotsLeaseTerminationStarted: { value: false },
    takeIteration: { value: 2 },
    claimsPerQueueType: new Map(),
    lastAgentPerQueueType: new Map(),
    failedAgentsPerQueueType: new Map(),
    ...overrides,
  };
}

function makeRuntime(
  sendUserTurnReturns = true,
): AgentSessionRuntime {
  return {
    sendUserTurn: vi.fn(() => sendUserTurnReturns),
  } as unknown as AgentSessionRuntime;
}

function makeChild(): ChildProcess {
  return new EventEmitter() as unknown as ChildProcess;
}

// ── Tests ────────────────────────────────────────────

describe("handleTakeLoopTurnEnded (foolery-6881)", () => {
  beforeEach(() => {
    backendGet.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test A: active state → follow-up sent
  it(
    "sends follow-up prompt when beat is still active",
    async () => {
      const ctx = makeCtx();
      const runtime = makeRuntime(true);
      const child = makeChild();
      backendGet.mockResolvedValueOnce({
        ok: true,
        data: { id: "beat-6881", state: "planning" },
      });

      const result = await handleTakeLoopTurnEnded(
        ctx, runtime, child,
      );

      expect(result).toBe(true);
      const call =
        (runtime.sendUserTurn as unknown as
          ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call).toBeDefined();
      expect(call[0]).toBe(child);
      expect(String(call[1])).toContain("still in state");
      expect(String(call[1])).toContain("beat-6881");
      expect(call[2]).toBe("take_loop_follow_up");
    },
  );

  // Test B: already advanced → no follow-up
  it(
    "does NOT send follow-up when beat has advanced",
    async () => {
      const ctx = makeCtx();
      const runtime = makeRuntime(true);
      const child = makeChild();
      // "shipped" is a terminal state in the fallback
      // workflow fixture above.
      backendGet.mockResolvedValueOnce({
        ok: true,
        data: { id: "beat-6881", state: "shipped" },
      });

      const result = await handleTakeLoopTurnEnded(
        ctx, runtime, child,
      );

      expect(result).toBe(false);
      expect(runtime.sendUserTurn).not.toHaveBeenCalled();
    },
  );

  // Test C: sendUserTurn fails → warn & return false
  it(
    "returns false and logs when sendUserTurn fails",
    async () => {
      const ctx = makeCtx();
      const runtime = makeRuntime(false);
      const child = makeChild();
      backendGet.mockResolvedValueOnce({
        ok: true,
        data: { id: "beat-6881", state: "planning" },
      });
      const warn = vi.spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const result = await handleTakeLoopTurnEnded(
        ctx, runtime, child,
      );

      expect(result).toBe(false);
      expect(runtime.sendUserTurn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalled();
      const warnMsg = warn.mock.calls
        .map((args) => args.join(" "))
        .join(" ");
      expect(warnMsg).toContain(
        "failed to send follow-up prompt",
      );
    },
  );

  it(
    "returns false when backend fetch fails",
    async () => {
      const ctx = makeCtx();
      const runtime = makeRuntime(true);
      const child = makeChild();
      backendGet.mockResolvedValueOnce({ ok: false });

      const result = await handleTakeLoopTurnEnded(
        ctx, runtime, child,
      );

      expect(result).toBe(false);
      expect(runtime.sendUserTurn).not.toHaveBeenCalled();
    },
  );
});

describe("buildTakeLoopFollowUpPrompt", () => {
  it("embeds the beat id and state", () => {
    const prompt = buildTakeLoopFollowUpPrompt(
      "foolery-6881", "workable",
    );
    expect(prompt).toContain("foolery-6881");
    expect(prompt).toContain("workable");
    expect(prompt).toContain("still in state");
    expect(prompt).toContain("kno rollback");
  });
});

// ── Test D: canary — wiring present in take-loop ────
//
// If this breaks, someone has removed the onTurnEnded
// wiring from `createTakeRuntimeBundle`. That is the
// exact fake-fix pattern this knot eradicates. Do NOT
// relax this test.
describe("take-loop runtime wiring canary", () => {
  it(
    "createTakeRuntimeBundle runtime has onTurnEnded",
    async () => {
      const {
        createTakeRuntimeBundle,
      } = await import(
        "@/lib/terminal-manager-take-child"
      );
      const {
        resolveCapabilities,
      } = await import(
        "@/lib/agent-session-capabilities"
      );
      const ctx = makeCtx();
      const capabilities = resolveCapabilities(
        "claude", true,
      );
      const { runtime } = createTakeRuntimeBundle(
        ctx, "planning", "claude",
        capabilities, null,
        /* isJsonRpc */ false,
        /* isHttpServer */ false,
        /* isAcp */ false,
      );

      expect(
        typeof runtime.config.onTurnEnded,
      ).toBe("function");
    },
  );
});
