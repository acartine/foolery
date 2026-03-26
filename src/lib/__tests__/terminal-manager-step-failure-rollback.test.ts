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

const loadSettingsMock = vi.fn();

vi.mock("@/lib/settings", () => ({
  getActionAgent: vi.fn(async () => ({ command: "codex", label: "Codex" })),
  getStepAgent: vi.fn(async () => ({ command: "codex", label: "Codex" })),
  loadSettings: (...args: unknown[]) => loadSettingsMock(...args),
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
import { rollbackBeatState } from "@/lib/memory-manager-commands";

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

describe("terminal-manager step-failure rollback", () => {
  beforeEach(async () => {
    nextKnotMock.mockReset();
    nextBeatMock.mockReset();
    createLeaseMock.mockReset();
    terminateLeaseMock.mockReset();
    resolveMemoryManagerTypeMock.mockReset();
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    loadSettingsMock.mockReset();
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single", maxClaimsPerQueueType: 10 });
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
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockClear();
    (rollbackBeatState as ReturnType<typeof vi.fn>).mockClear();

    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  it("non-zero exit code triggers enforceQueueTerminalInvariant rollback", async () => {
    // Using custom prompt avoids buildTakePrompt during createSession
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r001",
        title: "Step failure rollback test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    // After the child exits with non-zero code, enforceQueueTerminalInvariant
    // fetches the beat. The agent left it in an active (action) state.
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r001",
        title: "Step failure rollback test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After rollback, re-fetch confirms the beat is back in queue state.
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r001",
        title: "Step failure rollback test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    await createSession("foolery-r001", "/tmp/repo", "custom prompt");
    expect(spawnedChildren).toHaveLength(1);

    // Child exits with non-zero code (step failure)
    spawnedChildren[0].emit("close", 1, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r001",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
      );
    });
  });

  it("take-loop step failure triggers rollback when agent leaves beat in active state", async () => {
    // No custom prompt -> take-loop mode. Need buildTakePrompt for initial + retry.
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r002",
        title: "Take-loop step failure",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "retry prompt" } });

    await createSession("foolery-r002", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // First child exits successfully (code 0).
    // Post-close state fetch (non-blocking, parallel)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r002",
        title: "Take-loop step failure",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt fetches current state: agent left it in active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r002",
        title: "Take-loop step failure",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After rollback in buildNextTakePrompt, refresh shows queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r002",
        title: "Take-loop step failure",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r002",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
        expect.stringContaining("rolled back from implementation to ready_for_implementation"),
      );
    });
  });

  it("per-queue-type claim limit triggers enforceQueueTerminalInvariant with rollback", async () => {
    // Use maxClaimsPerQueueType=3, so after 3 claims buildNextTakePrompt returns null.
    // Each iteration: child exits 0 → buildNextTakePrompt succeeds → new child spawned.
    // On the 4th buildNextTakePrompt call, the per-queue-type limit is exceeded and loop stops.
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single", maxClaimsPerQueueType: 3 });

    const beatData = {
      id: "foolery-r003",
      title: "Max claims rollback",
      state: "ready_for_implementation",
      isAgentClaimable: true,
    };
    const activeBeatData = {
      id: "foolery-r003",
      title: "Max claims rollback",
      state: "implementation",
      isAgentClaimable: false,
    };

    // Initial createSession: get beat, listWorkflows, list, buildTakePrompt
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "iteration prompt" },
    });

    // Create take-loop session (no custom prompt).
    await createSession("foolery-r003", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // For intermediate iterations, backend.get always returns claimable queue state.
    backend.get.mockResolvedValue({ ok: true, data: { ...beatData } });

    // Drive through 3 claims (children 2, 3, 4)
    for (let i = 0; i < 3; i++) {
      const childIndex = spawnedChildren.length - 1;
      spawnedChildren[childIndex].emit("close", 0, null);

      // Wait for the next child to be spawned before continuing
      await waitFor(() => {
        expect(spawnedChildren).toHaveLength(childIndex + 2);
      });
    }

    // Now the 4th child exits with code 0. buildNextTakePrompt will see
    // claimsPerQueueType("implementation") = 4 > 3 and stop.
    // enforceQueueTerminalInvariant runs — return active state to trigger rollback.
    backend.get.mockReset();
    // Post-close state fetch
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...activeBeatData } });
    // buildNextTakePrompt fetch
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });
    // enforceQueueTerminalInvariant (called from within buildNextTakePrompt when limit exceeded)
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...activeBeatData } });
    // After rollback, re-fetch confirms queue state
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });
    // enforceQueueTerminalInvariant after buildNextTakePrompt returns null
    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });

    const lastChild = spawnedChildren[spawnedChildren.length - 1];
    lastChild.emit("close", 0, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r003",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
      );
    });

    // No additional children spawned after claim limit
    // 1 initial + 3 take-loop = 4 total
    expect(spawnedChildren).toHaveLength(4);
  });

  it("after rollback the beat is in a queue (claimable) state, not stuck active", async () => {
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r004",
        title: "Invariant after rollback",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-r004", "/tmp/repo", "custom prompt");
    expect(spawnedChildren).toHaveLength(1);

    // After non-zero exit, enforceQueueTerminalInvariant fetches: active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r004",
        title: "Invariant after rollback",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After rollback, re-fetch: queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r004",
        title: "Invariant after rollback",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 1, null);

    // Verify rollback was called to move from active to queue state
    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r004",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
      );
    });

    // Session finishes with error status (not stuck in running)
    await waitFor(() => {
      expect(interactionLog.logEnd).toHaveBeenCalledWith(1, "error");
    });

    // No second child should be spawned -- the session ends cleanly
    expect(spawnedChildren).toHaveLength(1);
  });

  it("concurrent abort during rollback is handled gracefully", async () => {
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r005",
        title: "Concurrent abort during rollback",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    const session = await createSession("foolery-r005", "/tmp/repo", "custom prompt");
    expect(spawnedChildren).toHaveLength(1);

    // Make rollbackBeatState slow so we can abort during it
    let rollbackResolve: () => void;
    const rollbackPromise = new Promise<void>((resolve) => {
      rollbackResolve = resolve;
    });
    (rollbackBeatState as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        await rollbackPromise;
      },
    );

    // enforceQueueTerminalInvariant fetches: active state -> triggers rollback
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r005",
        title: "Concurrent abort during rollback",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After rollback completes, re-fetch
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-r005",
        title: "Concurrent abort during rollback",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    // Child exits with non-zero code -> enforceQueueTerminalInvariant starts
    spawnedChildren[0].emit("close", 1, null);

    // Wait for rollbackBeatState to be called (it is now blocked)
    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalled();
    });

    // Abort the session while rollback is in progress
    const aborted = abortSession(session.id);
    expect(aborted).toBe(true);

    // Let the rollback complete
    rollbackResolve!();

    // Session should finish gracefully with "aborted" status
    await waitFor(() => {
      const entry = getSession(session.id);
      expect(entry).toBeDefined();
      expect(entry!.session.status).toBe("aborted");
    });

    // No extra children should have been spawned
    expect(spawnedChildren).toHaveLength(1);
  });
});
