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
  showKnot: vi.fn(async () => ({ ok: true, data: { lease_id: null } })),
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

import { createSession, abortSession, getSession } from "@/lib/terminal-manager";

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

function resetAbortMocks(): void {
  nextKnotMock.mockReset();
  nextBeatMock.mockReset();
  createLeaseMock.mockReset();
  terminateLeaseMock.mockReset();
  resolveMemoryManagerTypeMock.mockReset();
  resolveMemoryManagerTypeMock.mockReturnValue("knots");
  createLeaseMock.mockResolvedValue({ ok: true, data: { id: "lease-k1" } });
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
}

async function setupAbortMocks(): Promise<void> {
  resetAbortMocks();
  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockClear();

  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function clearAbortSessions(): void {
  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

describe("terminal-manager abort behavior", () => {
  beforeEach(async () => {
    await setupAbortMocks();
  });

  afterEach(() => {
    clearAbortSessions();
  });

  describe("abort status preservation", () => {
    it("abortSession preserves 'aborted' status after child exit", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-a001",
        title: "Abort test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    const session = await createSession("foolery-a001", "/tmp/repo", "custom prompt");
    expect(spawnedChildren).toHaveLength(1);

    // Abort the session
    const aborted = abortSession(session.id);
    expect(aborted).toBe(true);

    // Simulate child exiting with code 0 (which would normally set status to "completed")
    spawnedChildren[0].emit("close", 0, "SIGTERM");

    await waitFor(() => {
      const entry = getSession(session.id);
      expect(entry).toBeDefined();
      // Status should remain "aborted", NOT "completed"
      expect(entry!.session.status).toBe("aborted");
    });
  });

  it("abortSession stops take-loop from spawning next iteration", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-a002",
        title: "Abort take-loop test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "loop prompt" } });

    const session = await createSession("foolery-a002", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Abort the session before the first child exits
    abortSession(session.id);

    // First child exits with code 0 — normally triggers take-loop continuation
    spawnedChildren[0].emit("close", 0, "SIGTERM");

    // Wait a bit for async processing
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have spawned a second child — abort should have prevented it
    expect(spawnedChildren).toHaveLength(1);

    // Session should be finished with "aborted" status
    const entry = getSession(session.id);
    expect(entry).toBeDefined();
    expect(entry!.session.status).toBe("aborted");
    });
  });

});

describe("abort: idempotency and take-loop interaction", () => {
  beforeEach(async () => {
    await setupAbortMocks();
  });

  afterEach(() => {
    clearAbortSessions();
  });

  describe("idempotency and take-loop interaction", () => {
    it("repeated abort calls are idempotent", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-a003",
        title: "Idempotent abort",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    const session = await createSession("foolery-a003", "/tmp/repo", "custom prompt");

    // Abort twice — should not throw
    expect(abortSession(session.id)).toBe(true);
    expect(abortSession(session.id)).toBe(true);

    // Simulate child exit
    spawnedChildren[0].emit("close", 0, "SIGTERM");

    await waitFor(() => {
      const entry = getSession(session.id);
      expect(entry).toBeDefined();
      expect(entry!.session.status).toBe("aborted");
    });
  });

  it("abort during take-loop iteration stops the spawned child", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-a004",
        title: "Abort mid-take-loop",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "loop prompt" } });

    const session = await createSession("foolery-a004", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // First child exits successfully — triggers take-loop
    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren.length).toBe(2);
    });

    // Now abort while second child is running
    abortSession(session.id);

    // Second child exits
    spawnedChildren[1].emit("close", 0, "SIGTERM");

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have spawned a third child
    expect(spawnedChildren).toHaveLength(2);

    const entry = getSession(session.id);
    expect(entry).toBeDefined();
    expect(entry!.session.status).toBe("aborted");
  });

  it("finishSession logs 'aborted' as the terminal status", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "foolery-a005",
        title: "Abort log check",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    const session = await createSession("foolery-a005", "/tmp/repo", "custom prompt");

    abortSession(session.id);
    spawnedChildren[0].emit("close", 0, "SIGTERM");

    await waitFor(() => {
      expect(interactionLog.logEnd).toHaveBeenCalledWith(0, "aborted");
      });
    });
  });

});

describe("abort: process group cleanup", () => {
  beforeEach(async () => {
    await setupAbortMocks();
  });

  afterEach(() => {
    clearAbortSessions();
  });

  describe("process group cleanup", () => {
    it("abortSession force-kills the process group even if the leader exits first", async () => {
    vi.useFakeTimers();
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
      if (target === -4321 && signal === "SIGTERM") return true;
      if (target === -4321 && signal === "SIGKILL") return true;
      throw new Error(`unexpected kill(${String(target)}, ${String(signal)})`);
    });

    try {
      backend.get.mockResolvedValue({
        ok: true,
        data: {
          id: "foolery-a006",
          title: "Abort descendant cleanup",
          state: "ready_for_implementation",
          isAgentClaimable: true,
        },
      });
      backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
      backend.list.mockResolvedValue({ ok: true, data: [] });

      const session = await createSession("foolery-a006", "/tmp/repo", "custom prompt");

      expect(abortSession(session.id)).toBe(true);

      vi.advanceTimersByTime(5000);

      expect(processKillSpy).toHaveBeenCalledWith(-4321, "SIGTERM");
      expect(processKillSpy).toHaveBeenCalledWith(-4321, "SIGKILL");
      expect(processKillSpy).not.toHaveBeenCalledWith(4321, 0);
    } finally {
      processKillSpy.mockRestore();
      vi.useRealTimers();
    }
    });
  });
});
