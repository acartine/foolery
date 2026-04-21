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
  logLeaseAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/beads-state-machine", () => ({
  nextBeat: (...args: unknown[]) => nextBeatMock(...args),
}));

vi.mock("@/lib/regroom", () => ({
  regroomAncestors: vi.fn(async () => undefined),
}));

const { loadSettingsMock, stubDispatchSettings } = vi.hoisted(() => {
  // Two-agent pools so the cross-agent / cross-iteration exclusion
  // logic in selectStepAgent (which removes the previous action
  // agent and the last agent per queue) still finds a candidate.
  // Both entries share the same command so tests that don't
  // assert which agent ran don't need to care.
  const pool = [
    { agentId: "codex", weight: 1 },
    { agentId: "codex-alt", weight: 1 },
  ];
  const baseSettings = {
    dispatchMode: "advanced",
    maxClaimsPerQueueType: 10,
    agents: {
      codex: {
        command: "codex",
        agent_type: "cli",
        vendor: "codex",
        label: "Codex",
      },
      "codex-alt": {
        command: "codex",
        agent_type: "cli",
        vendor: "codex",
        label: "Codex",
      },
    },
    actions: { take: "", scene: "", scopeRefinement: "" },
    pools: {
      orchestration: pool,
      planning: pool,
      plan_review: pool,
      implementation: pool,
      implementation_review: pool,
      shipment: pool,
      shipment_review: pool,
      scope_refinement: pool,
    },
  };
  return {
    loadSettingsMock: vi.fn(),
    stubDispatchSettings: (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({ ...baseSettings, ...overrides }),
  };
});

vi.mock("@/lib/settings", () => ({
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

function resetStepFailureMocks(): void {
  nextKnotMock.mockReset();
  nextBeatMock.mockReset();
  createLeaseMock.mockReset();
  terminateLeaseMock.mockReset();
  resolveMemoryManagerTypeMock.mockReset();
  resolveMemoryManagerTypeMock.mockReturnValue("knots");
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue(stubDispatchSettings());
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

async function setupStepFailureMocks(): Promise<void> {
  resetStepFailureMocks();
  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockClear();
  (rollbackBeatState as ReturnType<typeof vi.fn>).mockClear();

  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function clearStepFailureSessions(): void {
  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function mockStepBeat(
  id: string, title: string, state: string, claimable = true,
): { ok: true; data: Record<string, unknown> } {
  return {
    ok: true,
    data: { id, title, state, isAgentClaimable: claimable },
  };
}

describe("step-failure: non-zero exit rollback", () => {
  beforeEach(async () => { await setupStepFailureMocks(); });
  afterEach(() => { clearStepFailureSessions(); });

  it("non-zero exit triggers enforceQueueTerminalInvariant rollback", async () => {
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r001", "Step failure rollback test",
      "ready_for_implementation",
    ));
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    // Post-exit: agent left beat in active state
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r001", "Step failure rollback test",
      "implementation", false,
    ));
    // After rollback, confirms queue state
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r001", "Step failure rollback test",
      "ready_for_implementation",
    ));

    await createSession("foolery-r001", "/tmp/repo", "custom prompt");
    expect(spawnedChildren).toHaveLength(1);
    spawnedChildren[0].emit("close", 1, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r001", "implementation",
        "ready_for_implementation", "/tmp/repo", "knots",
      );
    });
  });
});

describe("step-failure: take-loop rollback", () => {
  beforeEach(async () => { await setupStepFailureMocks(); });
  afterEach(() => { clearStepFailureSessions(); });

  it("take-loop step failure triggers rollback on active state", async () => {
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r002", "Take-loop step failure",
      "ready_for_implementation",
    ));
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "initial prompt" },
      })
      .mockResolvedValueOnce({
        ok: true, data: { prompt: "retry prompt" },
      });

    await createSession("foolery-r002", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Post-close: queue state, then active, then queue again
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r002", "Take-loop step failure",
      "ready_for_implementation",
    ));
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r002", "Take-loop step failure",
      "implementation", false,
    ));
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r002", "Take-loop step failure",
      "ready_for_implementation",
    ));

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r002", "implementation",
        "ready_for_implementation", "/tmp/repo", "knots",
        expect.stringContaining(
          "rolled back from implementation",
        ),
      );
    });
  });
});

describe("step-failure: per-queue-type claim limit rollback", () => {
  beforeEach(async () => { await setupStepFailureMocks(); });
  afterEach(() => { clearStepFailureSessions(); });

  it("claim limit triggers enforceQueueTerminalInvariant with rollback", async () => {
    loadSettingsMock.mockResolvedValue(
      stubDispatchSettings({ maxClaimsPerQueueType: 3 }),
    );
    const beat = mockStepBeat(
      "foolery-r003", "Max claims rollback",
      "ready_for_implementation",
    );
    const activeBeat = mockStepBeat(
      "foolery-r003", "Max claims rollback",
      "implementation", false,
    );

    backend.get.mockResolvedValueOnce(beat);
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true, data: { prompt: "iteration prompt" },
    });

    await createSession("foolery-r003", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);
    backend.get.mockResolvedValue(beat);

    // Drive through 3 claims (children 2, 3, 4)
    for (let i = 0; i < 3; i++) {
      const idx = spawnedChildren.length - 1;
      spawnedChildren[idx].emit("close", 0, null);
      await waitFor(() => {
        expect(spawnedChildren).toHaveLength(idx + 2);
      });
    }

    // 4th child exits: limit exceeded, rollback triggers
    backend.get.mockReset();
    backend.get.mockResolvedValueOnce(activeBeat);
    backend.get.mockResolvedValueOnce(beat);
    backend.get.mockResolvedValueOnce(activeBeat);
    backend.get.mockResolvedValueOnce(beat);
    backend.get.mockResolvedValueOnce(beat);

    spawnedChildren[spawnedChildren.length - 1].emit("close", 0, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r003", "implementation",
        "ready_for_implementation", "/tmp/repo", "knots",
      );
    });
    expect(spawnedChildren).toHaveLength(4);
  });
});

describe("step-failure: invariant after rollback", () => {
  beforeEach(async () => { await setupStepFailureMocks(); });
  afterEach(() => { clearStepFailureSessions(); });

  it("after rollback the beat is in queue state, not stuck active", async () => {
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r004", "Invariant after rollback",
      "ready_for_implementation",
    ));
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-r004", "/tmp/repo", "custom prompt");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r004", "Invariant after rollback",
      "implementation", false,
    ));
    backend.get.mockResolvedValueOnce(mockStepBeat(
      "foolery-r004", "Invariant after rollback",
      "ready_for_implementation",
    ));

    spawnedChildren[0].emit("close", 1, null);

    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-r004", "implementation",
        "ready_for_implementation", "/tmp/repo", "knots",
      );
    });
    await waitFor(() => {
      expect(interactionLog.logEnd).toHaveBeenCalledWith(1, "error");
    });
    expect(spawnedChildren).toHaveLength(1);
  });
});

describe("step-failure: concurrent abort during rollback", () => {
  beforeEach(async () => {
    await setupStepFailureMocks();
  });

  afterEach(() => {
    clearStepFailureSessions();
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
