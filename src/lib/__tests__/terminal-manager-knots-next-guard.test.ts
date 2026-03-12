import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextKnotMock = vi.fn();
const nextBeatMock = vi.fn();
const resolveMemoryManagerTypeMock = vi.fn(() => "knots");
type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { writable: boolean; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  pid: number;
  killed?: boolean;
};
const spawnedChildren: MockChild[] = [];

const backend = {
  get: vi.fn(),
  list: vi.fn(),
  listWorkflows: vi.fn(),
  buildTakePrompt: vi.fn(),
  update: vi.fn(),
};

const interactionLog = {
  filePath: undefined as string | undefined,
  logPrompt: vi.fn(),
  logStdout: vi.fn(),
  logStderr: vi.fn(),
  logResponse: vi.fn(),
  logBeatState: vi.fn(),
  logEnd: vi.fn(),
};

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as MockChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      writable: true,
      write: vi.fn(() => true),
      end: vi.fn(),
    };
    child.kill = vi.fn(() => {
      child.killed = true;
      return true;
    });
    child.pid = 4321;
    spawnedChildren.push(child);
    return child;
  }),
  exec: vi.fn((_cmd: string, _opts: unknown, cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    if (cb) cb(null, { stdout: "", stderr: "" });
  }),
}));

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => backend,
}));

vi.mock("@/lib/interaction-logger", () => ({
  startInteractionLog: vi.fn(async () => interactionLog),
  noopInteractionLog: vi.fn(() => interactionLog),
}));

vi.mock("@/lib/knots", () => ({
  nextKnot: (...args: unknown[]) => nextKnotMock(...args),
}));

vi.mock("@/lib/beads-state-machine", () => ({
  nextBeat: (...args: unknown[]) => nextBeatMock(...args),
}));

vi.mock("@/lib/regroom", () => ({
  regroomAncestors: vi.fn(async () => undefined),
}));

vi.mock("@/lib/settings", () => ({
  getActionAgent: vi.fn(async () => ({ command: "codex", label: "Codex" })),
  getStepAgent: vi.fn(async () => ({ command: "codex", label: "Codex" })),
  loadSettings: vi.fn(async () => ({ dispatchMode: "single" })),
}));

vi.mock("@/lib/memory-manager-commands", () => ({
  resolveMemoryManagerType: () => resolveMemoryManagerTypeMock(),
  buildShowIssueCommand: vi.fn((id: string) => `kno show ${JSON.stringify(id)}`),
  buildClaimCommand: vi.fn((id: string) => `kno claim ${JSON.stringify(id)} --json`),
  buildWorkflowStateCommand: vi.fn(
    (id: string, state: string) =>
      `kno next ${JSON.stringify(id)} --expected-state ${JSON.stringify(state)} --actor-kind agent`,
  ),
  rollbackBeatState: vi.fn(async () => undefined),
  assertClaimable: vi.fn(),
  supportsAutoFollowUp: vi.fn(() => false),
}));

vi.mock("@/lib/validate-cwd", () => ({
  validateCwd: vi.fn(async () => null),
}));

vi.mock("@/lib/agent-message-type-index", () => ({
  updateMessageTypeIndexFromSession: vi.fn(async () => undefined),
}));

import { createSession, getSession } from "@/lib/terminal-manager";
import { rollbackBeatState, assertClaimable } from "@/lib/memory-manager-commands";

/** Polls `fn` until it stops throwing, or rejects after `timeout` ms. */
async function waitFor(fn: () => void, { timeout = 2000, interval = 10 } = {}): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      fn();
      return;
    } catch (err) {
      if (Date.now() - start >= timeout) throw err;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}

describe("terminal-manager nextKnot expected-state guard", () => {
  beforeEach(async () => {
    nextKnotMock.mockReset();
    nextBeatMock.mockReset();
    resolveMemoryManagerTypeMock.mockReset();
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    spawnedChildren.length = 0;
    backend.get.mockReset();
    backend.list.mockReset();
    backend.listWorkflows.mockReset();
    backend.buildTakePrompt.mockReset();
    backend.update.mockReset();
    interactionLog.logPrompt.mockReset();
    interactionLog.logStdout.mockReset();
    interactionLog.logStderr.mockReset();
    interactionLog.logResponse.mockReset();
    interactionLog.logBeatState.mockReset();
    interactionLog.logEnd.mockReset();
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockClear();

    const sessions = (globalThis as { __terminalSessions?: Map<string, unknown> }).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    const sessions = (globalThis as { __terminalSessions?: Map<string, unknown> }).__terminalSessions;
    sessions?.clear();
  });

  it("rolls back active knot to queue state instead of advancing forward", async () => {
    backend.get
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d4",
          title: "Fix double kno-next",
          state: "implementation",
          isAgentClaimable: false,
        },
      })
      // After rollback, the beat is back in queue state
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d4",
          title: "Fix double kno-next",
          state: "ready_for_implementation",
          isAgentClaimable: true,
        },
      });

    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-e6d4", "/tmp/repo", "custom prompt");

    // Should NOT advance forward via nextKnot — rollback uses rollbackBeatState instead
    expect(nextKnotMock).not.toHaveBeenCalled();
    // Backend.get called twice: initial fetch + post-rollback refresh
    expect(backend.get).toHaveBeenCalledTimes(2);
    expect(rollbackBeatState).toHaveBeenCalledWith(
      "foolery-e6d4",
      "implementation",
      "ready_for_implementation",
      "/tmp/repo",
      "knots",
      expect.any(String),
    );
  });

  it("rolls back active beads-managed beat to queue state instead of advancing forward", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    backend.update.mockResolvedValue({ ok: true });
    backend.get
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d5",
          title: "Fix double bd-next",
          state: "implementation",
          isAgentClaimable: false,
        },
      })
      // After rollback, the beat is back in queue state
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d5",
          title: "Fix double bd-next",
          state: "ready_for_implementation",
          isAgentClaimable: true,
        },
      });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-e6d5", "/tmp/repo", "custom prompt");

    // Should NOT advance forward via nextBeat
    expect(nextBeatMock).not.toHaveBeenCalled();
    expect(nextKnotMock).not.toHaveBeenCalled();
    // Should rollback via rollbackBeatState
    expect(rollbackBeatState).toHaveBeenCalledWith(
      "foolery-e6d5",
      "implementation",
      "ready_for_implementation",
      "/tmp/repo",
      "beads",
      expect.any(String),
    );
  });

  it("logs initial prompt for one-shot agents", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-1000",
        title: "Record prompt history",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-1000", "/tmp/repo", "show this prompt in history");

    expect(spawnedChildren).toHaveLength(1);
    expect(interactionLog.logPrompt).toHaveBeenCalledWith("show this prompt in history", { source: "initial" });
  });

  it("wraps app-generated initial prompt for one-shot scene sessions", async () => {
    // Scene orchestration only applies to beads repos; knots parents use Take mode.
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-3000",
        title: "Scene prompt visibility",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "foolery-3001",
          title: "Child beat",
          state: "ready_for_implementation",
          isAgentClaimable: true,
        },
      ],
    });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "scene app prompt" },
    });

    await createSession("foolery-3000", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    expect(interactionLog.logPrompt).toHaveBeenCalledTimes(1);
    const initialPrompt = interactionLog.logPrompt.mock.calls[0]?.[0];
    expect(typeof initialPrompt).toBe("string");
    expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
    expect(initialPrompt).toContain("Execute only the child beats explicitly listed below.");
    expect(initialPrompt).toContain("scene app prompt");
    expect(interactionLog.logPrompt).toHaveBeenCalledWith(initialPrompt, { source: "initial" });
  });

  it("wraps knots parent prompt as Scene", async () => {
    // Knots parents should use Scene orchestration, with the prompt instructing
    // the agent to claim and advance each child beat individually.
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-3050",
        title: "Knots parent beat",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "foolery-3051",
          title: "Child knot",
          state: "ready_for_implementation",
          isAgentClaimable: true,
        },
      ],
    });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "knots parent prompt" },
    });

    await createSession("foolery-3050", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    expect(backend.buildTakePrompt).toHaveBeenCalledWith(
      "foolery-3050",
      { isParent: true, childBeatIds: ["foolery-3051"] },
      "/tmp/repo",
    );
    expect(interactionLog.logPrompt).toHaveBeenCalledTimes(1);
    const initialPrompt = interactionLog.logPrompt.mock.calls[0]?.[0];
    expect(typeof initialPrompt).toBe("string");
    expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
    // Should use Scene wrapping, not Take wrapping
    expect(initialPrompt).toContain("Execute only the child beats explicitly listed below.");
    expect(initialPrompt).not.toContain("Execute only the currently assigned workflow action described below.");
    expect(initialPrompt).toContain("knots parent prompt");
  });

  it("wraps backend prompt for beads-managed beats", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-3100",
        title: "Beads prompt visibility",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "beads app prompt" },
    });

    await createSession("foolery-3100", "/tmp/repo");

    const initialPrompt = interactionLog.logPrompt.mock.calls[0]?.[0];
    expect(typeof initialPrompt).toBe("string");
    expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
    expect(initialPrompt).toContain("Execute only the currently assigned workflow action described below.");
    expect(initialPrompt).toContain("beads app prompt");
    expect(interactionLog.logPrompt).toHaveBeenCalledWith(initialPrompt, { source: "initial" });
  });

  it("logs take-loop prompts for one-shot agents", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-2000",
        title: "Take-loop prompt visibility",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial app prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "loop app prompt" } });

    await createSession("foolery-2000", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
      const initialPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) => (args[1] as Record<string, unknown>)?.source === "initial",
      )?.[0];
      const loopPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) => (args[1] as Record<string, unknown>)?.source === "take_2",
      )?.[0];

      expect(typeof initialPrompt).toBe("string");
      expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
      expect(initialPrompt).toContain("initial app prompt");

      expect(typeof loopPrompt).toBe("string");
      expect(loopPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
      expect(loopPrompt).toContain("loop app prompt");
    });
  });

  it("runs the take loop for beads-managed single-beat sessions", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-2100",
        title: "Beads take-loop prompt visibility",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial beads prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "loop beads prompt" } });

    await createSession("foolery-2100", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
      const initialPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) => (args[1] as Record<string, unknown>)?.source === "initial",
      )?.[0];
      const loopPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) => (args[1] as Record<string, unknown>)?.source === "take_2",
      )?.[0];

      expect(typeof initialPrompt).toBe("string");
      expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
      expect(initialPrompt).toContain("initial beads prompt");

      expect(typeof loopPrompt).toBe("string");
      expect(loopPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
      expect(loopPrompt).toContain("loop beads prompt");
    });
  });


  it("wraps backend prompt during take-loop iterations", async () => {
    const reviewBeat = {
      id: "foolery-3000",
      title: "Review preamble regression",
      state: "ready_for_implementation_review",
      isAgentClaimable: true,
    };
    // 1) Initial fetch in createSession
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-3000",
        title: "Review preamble regression",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // 2) enforceQueueTerminalInvariant after first child closes
    backend.get.mockResolvedValueOnce({ ok: true, data: reviewBeat });
    // 3) buildNextTakePrompt fetches current state
    backend.get.mockResolvedValueOnce({ ok: true, data: reviewBeat });
    // 4) enforceQueueTerminalInvariant after second child closes
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...reviewBeat, state: "shipped" } });

    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial impl prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "review iteration prompt" } });

    await createSession("foolery-3000", "/tmp/repo");

    // First agent finishes — triggers take-loop
    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);

      const initialPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) => (args[1] as Record<string, unknown>)?.source === "initial",
      )?.[0];
      expect(typeof initialPrompt).toBe("string");
      expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
      expect(initialPrompt).toContain("initial impl prompt");

      // Take-loop prompt preserves the backend content but now adds the execution boundary.
      const take2Calls = interactionLog.logPrompt.mock.calls.filter(
        (args: unknown[]) =>
          (args[1] as Record<string, unknown>)?.source === "take_2",
      );
      expect(take2Calls).toHaveLength(1);
      expect(take2Calls[0]?.[0]).toContain("FOOLERY EXECUTION BOUNDARY:");
      expect(take2Calls[0]?.[0]).toContain("review iteration prompt");
    });
  });

  it("includes selected agent label in Claimed and TAKE log lines", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-4000",
        title: "Agent label in logs",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "loop prompt" } });

    const session = await createSession("foolery-4000", "/tmp/repo");

    // First child finishes — triggers take-loop iteration 2
    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
    });

    const entry = getSession(session.id);
    expect(entry).toBeDefined();
    const stdoutEvents = entry!.buffer
      .filter((e: { type: string; data: string }) => e.type === "stdout")
      .map((e: { type: string; data: string }) => e.data);

    // Claimed line should include [agent: Codex]
    const claimedLine = stdoutEvents.find((d) => d.includes("Claimed"));
    expect(claimedLine).toBeDefined();
    expect(claimedLine).toContain("[agent: Codex]");

    // TAKE line should include [agent: Codex]
    const takeLine = stdoutEvents.find((d) => d.includes("TAKE 2/"));
    expect(takeLine).toBeDefined();
    expect(takeLine).toContain("[agent: Codex]");
  });

  describe("pre-dispatch rollback edge cases", () => {
    it("handles rollbackBeatState throwing without crashing the session", async () => {
      const rollbackMock = vi.mocked(rollbackBeatState);
      rollbackMock.mockRejectedValueOnce(new Error("rollback command failed"));

      // After rollback fails, backend.get is NOT called a second time;
      // the function returns the original beat with rolledBack: false.
      // assertClaimable then runs on the original non-claimable beat.
      backend.get.mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e700",
          title: "Rollback throws",
          state: "implementation",
          isAgentClaimable: false,
        },
      });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      // assertClaimable is called with the original non-claimable beat,
      // which for knots will throw. The session creation rejects.
      const assertMock = vi.mocked(assertClaimable);
      assertMock.mockImplementationOnce(() => {
        throw new Error("Take unavailable: knot is not agent-claimable (foolery-e700 (implementation))");
      });

      await expect(
        createSession("foolery-e700", "/tmp/repo", "test prompt"),
      ).rejects.toThrow("not agent-claimable");

      // Verify rollback was attempted
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-e700",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
        expect.any(String),
      );
      // No second backend.get because rollback failed
      expect(backend.get).toHaveBeenCalledTimes(1);
      // Agent should not have been spawned
      expect(spawnedChildren).toHaveLength(0);
    });

    it("rejects when beat remains non-claimable after rollback", async () => {
      backend.get
        .mockResolvedValueOnce({
          ok: true,
          data: {
            id: "foolery-e701",
            title: "Still non-claimable",
            state: "implementation",
            isAgentClaimable: false,
          },
        })
        // After rollback, backend.get returns beat still non-claimable
        .mockResolvedValueOnce({
          ok: true,
          data: {
            id: "foolery-e701",
            title: "Still non-claimable",
            state: "implementation",
            isAgentClaimable: false,
          },
        });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      // assertClaimable sees the still-non-claimable beat and throws
      const assertMock = vi.mocked(assertClaimable);
      assertMock.mockImplementationOnce(() => {
        throw new Error("Take unavailable: knot is not agent-claimable (foolery-e701 (implementation))");
      });

      await expect(
        createSession("foolery-e701", "/tmp/repo", "test prompt"),
      ).rejects.toThrow("not agent-claimable");

      // Rollback was attempted
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-e701",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
        expect.any(String),
      );
      // backend.get called twice: initial + post-rollback refresh
      expect(backend.get).toHaveBeenCalledTimes(2);
      expect(spawnedChildren).toHaveLength(0);
    });

    it("skips rollback when beat is already in a claimable queue state", async () => {
      // Clear rollbackBeatState calls from prior tests in this suite
      vi.mocked(rollbackBeatState).mockClear();

      backend.get.mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e702",
          title: "Already queued",
          state: "ready_for_implementation",
          isAgentClaimable: true,
        },
      });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      await createSession("foolery-e702", "/tmp/repo", "test prompt");

      // rollbackBeatState should NOT be called — beat is already claimable
      expect(rollbackBeatState).not.toHaveBeenCalled();
      // backend.get called only once — no rollback refresh needed
      expect(backend.get).toHaveBeenCalledTimes(1);
      // Agent should have been spawned normally
      expect(spawnedChildren).toHaveLength(1);
    });
  });
});
