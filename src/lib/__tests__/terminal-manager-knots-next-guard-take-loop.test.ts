/**
 * Terminal manager knots next guard: take-loop, agent labels, edge cases.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextKnotMock = vi.fn();
const nextBeatMock = vi.fn();
const resolveMemoryManagerTypeMock = vi.fn(() => "knots");
const createLeaseMock = vi.fn();
const terminateLeaseMock = vi.fn();
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
  exec: vi.fn((
    _cmd: string, _opts: unknown,
    cb?: (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    if (cb) cb(null, { stdout: "", stderr: "" });
  }),
}));

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => backend,
}));

vi.mock("@/lib/interaction-logger", () => ({
  resolveInteractionLogRoot: vi.fn(() => "/tmp/foolery-logs"),
  startInteractionLog: vi.fn(async () => interactionLog),
  noopInteractionLog: vi.fn(() => interactionLog),
}));

vi.mock("@/lib/knots", () => ({
  nextKnot: (...args: unknown[]) => nextKnotMock(...args),
  createLease: (...args: unknown[]) => createLeaseMock(...args),
  terminateLease: (...args: unknown[]) => terminateLeaseMock(...args),
}));

vi.mock("@/lib/lease-audit", () => ({
  appendLeaseAuditEvent: vi.fn(async () => undefined),
  logLeaseAudit: vi.fn(),
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
  buildShowIssueCommand: vi.fn(
    (id: string) => `kno show ${JSON.stringify(id)}`,
  ),
  buildClaimCommand: vi.fn(
    (id: string) => `kno claim ${JSON.stringify(id)} --json`,
  ),
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
import {
  rollbackBeatState,
  assertClaimable,
} from "@/lib/memory-manager-commands";

async function waitFor(
  fn: () => void,
  { timeout = 2000, interval = 10 } = {},
): Promise<void> {
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

describe("terminal-manager nextKnot guard: take-loop and agent labels", () => {
  beforeEach(async () => {
    nextKnotMock.mockReset();
    nextBeatMock.mockReset();
    createLeaseMock.mockReset();
    terminateLeaseMock.mockReset();
    resolveMemoryManagerTypeMock.mockReset();
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    createLeaseMock.mockResolvedValue({
      ok: true, data: { id: "lease-k1" },
    });
    terminateLeaseMock.mockResolvedValue({ ok: true });
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

    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  it("logs take-loop prompts for one-shot agents", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-2000", title: "Take-loop prompt visibility",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "initial app prompt" },
      })
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "loop app prompt" },
      });

    await createSession("foolery-2000", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
      const initialPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) =>
          (args[1] as Record<string, unknown>)?.source === "initial",
      )?.[0];
      const loopPrompt = interactionLog.logPrompt.mock.calls.find(
        (args: unknown[]) =>
          (args[1] as Record<string, unknown>)?.source === "take_2",
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
        id: "foolery-2100", title: "Beads take-loop prompt visibility",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "initial beads prompt" },
      })
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "loop beads prompt" },
      });

    await createSession("foolery-2100", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
    });
  });

  it("wraps backend prompt during take-loop iterations", async () => {
    const reviewBeat = {
      id: "foolery-3000", title: "Review preamble regression",
      state: "ready_for_implementation_review", isAgentClaimable: true,
    };
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-3000", title: "Review preamble regression",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({ ok: true, data: reviewBeat });
    backend.get.mockResolvedValueOnce({ ok: true, data: reviewBeat });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: { ...reviewBeat, state: "shipped" },
    });

    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "initial impl prompt" },
      })
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "review iteration prompt" },
      });

    await createSession("foolery-3000", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);

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
        id: "foolery-4000", title: "Agent label in logs",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "initial prompt" },
      })
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "loop prompt" },
      });

    const session = await createSession("foolery-4000", "/tmp/repo");

    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
    });

    const entry = getSession(session.id);
    expect(entry).toBeDefined();
    const stdoutEvents = entry!.buffer
      .filter(
        (e: { type: string; data: string }) => e.type === "stdout",
      )
      .map((e: { type: string; data: string }) => e.data);

    const claimedLine = stdoutEvents.find(
      (d: string) => d.includes("Claimed"),
    );
    expect(claimedLine).toBeDefined();
    expect(claimedLine).toContain("[agent: Codex]");

    const takeLine = stdoutEvents.find(
      (d: string) => d.includes("TAKE 2"),
    );
    expect(takeLine).toBeDefined();
    expect(takeLine).toContain("[agent: Codex]");
  });

  describe("pre-dispatch rollback edge cases", () => {
    it("handles rollbackBeatState throwing without crashing", async () => {
      const rollbackMock = vi.mocked(rollbackBeatState);
      rollbackMock.mockRejectedValueOnce(
        new Error("rollback command failed"),
      );

      backend.get.mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e700", title: "Rollback throws",
          state: "implementation", isAgentClaimable: false,
        },
      });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      const assertMock = vi.mocked(assertClaimable);
      assertMock.mockImplementationOnce(() => {
        throw new Error(
          "Take unavailable: knot is not agent-claimable (foolery-e700 (implementation))",
        );
      });

      await expect(
        createSession("foolery-e700", "/tmp/repo", "test prompt"),
      ).rejects.toThrow("not agent-claimable");

      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-e700", "implementation", "ready_for_implementation",
        "/tmp/repo", "knots", expect.any(String),
      );
      expect(backend.get).toHaveBeenCalledTimes(1);
      expect(spawnedChildren).toHaveLength(0);
    });

    it("rejects when beat remains non-claimable after rollback", async () => {
      backend.get
        .mockResolvedValueOnce({
          ok: true,
          data: {
            id: "foolery-e701", title: "Still non-claimable",
            state: "implementation", isAgentClaimable: false,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            id: "foolery-e701", title: "Still non-claimable",
            state: "implementation", isAgentClaimable: false,
          },
        });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      const assertMock = vi.mocked(assertClaimable);
      assertMock.mockImplementationOnce(() => {
        throw new Error(
          "Take unavailable: knot is not agent-claimable (foolery-e701 (implementation))",
        );
      });

      await expect(
        createSession("foolery-e701", "/tmp/repo", "test prompt"),
      ).rejects.toThrow("not agent-claimable");

      expect(rollbackBeatState).toHaveBeenCalled();
      expect(backend.get).toHaveBeenCalledTimes(2);
      expect(spawnedChildren).toHaveLength(0);
    });

    it("skips rollback when beat is already in claimable queue state", async () => {
      vi.mocked(rollbackBeatState).mockClear();

      backend.get.mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e702", title: "Already queued",
          state: "ready_for_implementation", isAgentClaimable: true,
        },
      });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      await createSession("foolery-e702", "/tmp/repo", "test prompt");

      expect(rollbackBeatState).not.toHaveBeenCalled();
      expect(backend.get).toHaveBeenCalledTimes(1);
      expect(spawnedChildren).toHaveLength(1);
    });
  });
});
