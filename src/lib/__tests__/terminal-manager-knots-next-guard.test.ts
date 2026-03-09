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

vi.mock("@/lib/memory-manager-commands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/memory-manager-commands")>(
    "@/lib/memory-manager-commands",
  );
  return {
    ...actual,
    resolveMemoryManagerType: () => resolveMemoryManagerTypeMock(),
  };
});

vi.mock("@/lib/validate-cwd", () => ({
  validateCwd: vi.fn(async () => null),
}));

vi.mock("@/lib/agent-message-type-index", () => ({
  updateMessageTypeIndexFromSession: vi.fn(async () => undefined),
}));

import { createSession } from "@/lib/terminal-manager";

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
    vi.mocked(exec).mockClear();

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

    // Should NOT advance forward via nextKnot — rollback uses kno update instead
    expect(nextKnotMock).not.toHaveBeenCalled();
    // Backend.get called twice: initial fetch + post-rollback refresh
    expect(backend.get).toHaveBeenCalledTimes(2);
    const { exec } = await import("node:child_process");
    expect(vi.mocked(exec)).toHaveBeenCalledWith(
      expect.stringContaining("kno update foolery-e6d4 --status ready_for_implementation"),
      expect.objectContaining({ cwd: "/tmp/repo" }),
      expect.any(Function),
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
    // Should rollback via backend.update
    expect(backend.update).toHaveBeenCalledWith(
      "foolery-e6d5",
      { state: "ready_for_implementation" },
      "/tmp/repo",
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

  it("logs app-generated initial prompt for one-shot scene sessions", async () => {
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
    expect(interactionLog.logPrompt).toHaveBeenCalledWith(
      "scene app prompt",
      { source: "initial" },
    );
  });

  it("passes backend prompt through for beads-managed beats", async () => {
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

    expect(interactionLog.logPrompt).toHaveBeenCalledWith(
      "beads app prompt",
      { source: "initial" },
    );
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

    await vi.waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
      expect(interactionLog.logPrompt).toHaveBeenCalledWith("initial app prompt", { source: "initial" });
      expect(interactionLog.logPrompt).toHaveBeenCalledWith("loop app prompt", { source: "take_2" });
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

    await vi.waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
      expect(interactionLog.logPrompt).toHaveBeenCalledWith("initial beads prompt", { source: "initial" });
      expect(interactionLog.logPrompt).toHaveBeenCalledWith("loop beads prompt", { source: "take_2" });
    });
  });


  it("passes backend prompt through without wrapper in take-loop iterations", async () => {
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

    await vi.waitFor(() => {
      expect(spawnedChildren.length).toBe(2);

      // Initial prompt is the backend prompt passed through directly
      expect(interactionLog.logPrompt).toHaveBeenCalledWith(
        "initial impl prompt",
        { source: "initial" },
      );

      // Take-loop prompt is also the backend prompt passed through directly
      const take2Calls = interactionLog.logPrompt.mock.calls.filter(
        (args: unknown[]) =>
          (args[1] as Record<string, unknown>)?.source === "take_2",
      );
      expect(take2Calls).toHaveLength(1);
      expect(take2Calls[0][0]).toBe("review iteration prompt");
    });
  });
});
