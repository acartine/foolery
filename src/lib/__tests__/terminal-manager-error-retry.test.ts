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

// appendOutcomeRecord is mocked via vi.mock above; imported below as a mock fn.

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
  getActionAgent: vi.fn(async () => ({
    command: "claude",
    label: "Claude",
    agentId: "agent-a",
    model: "opus",
    version: "4.6",
  })),
  getStepAgent: vi.fn(async () => ({
    command: "claude",
    label: "Claude",
    agentId: "agent-a",
    model: "opus",
    version: "4.6",
  })),
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

vi.mock("@/lib/agent-outcome-stats", () => ({
  appendOutcomeRecord: vi.fn(async () => undefined),
}));

import { createSession } from "@/lib/terminal-manager";
import { rollbackBeatState } from "@/lib/memory-manager-commands";
import { appendOutcomeRecord } from "@/lib/agent-outcome-stats";

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

// Settings with two agents in the implementation pool
const advancedSettingsWithTwoAgents = {
  dispatchMode: "advanced",
  maxClaimsPerQueueType: 10,
  pools: {
    planning: [{ agentId: "agent-a", weight: 1 }, { agentId: "agent-b", weight: 1 }],
    plan_review: [{ agentId: "agent-a", weight: 1 }, { agentId: "agent-b", weight: 1 }],
    implementation: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
    ],
    implementation_review: [{ agentId: "agent-a", weight: 1 }, { agentId: "agent-b", weight: 1 }],
    shipment: [{ agentId: "agent-a", weight: 1 }, { agentId: "agent-b", weight: 1 }],
    shipment_review: [{ agentId: "agent-a", weight: 1 }, { agentId: "agent-b", weight: 1 }],
  },
  agents: {
    "agent-a": { command: "claude", label: "Claude", model: "opus", version: "4.6" },
    "agent-b": { command: "codex", label: "Codex", model: "o4-mini", version: "1.0" },
  },
};

// Settings with only one agent in the implementation pool
const advancedSettingsOneAgent = {
  dispatchMode: "advanced",
  maxClaimsPerQueueType: 10,
  pools: {
    planning: [{ agentId: "agent-a", weight: 1 }],
    plan_review: [{ agentId: "agent-a", weight: 1 }],
    implementation: [{ agentId: "agent-a", weight: 1 }],
    implementation_review: [{ agentId: "agent-a", weight: 1 }],
    shipment: [{ agentId: "agent-a", weight: 1 }],
    shipment_review: [{ agentId: "agent-a", weight: 1 }],
  },
  agents: {
    "agent-a": { command: "claude", label: "Claude", model: "opus", version: "4.6" },
  },
};

describe("terminal-manager error-exit retry", () => {
  beforeEach(async () => {
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
    loadSettingsMock.mockReset();
    (appendOutcomeRecord as ReturnType<typeof vi.fn>).mockReset();
    const { exec } = await import("node:child_process");
    (exec as unknown as ReturnType<typeof vi.fn>).mockClear();
    (rollbackBeatState as ReturnType<typeof vi.fn>).mockClear();

    const sessions = (globalThis as { __terminalSessions?: Map<string, unknown> }).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    const sessions = (globalThis as { __terminalSessions?: Map<string, unknown> }).__terminalSessions;
    sessions?.clear();
  });

  it("non-zero exit retries with different agent when alternative exists", async () => {
    // Take-loop mode (no custom prompt).
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    // Initial createSession: get beat, listWorkflows, list, buildTakePrompt
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e001",
        title: "Error retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "retry prompt" } });

    await createSession("foolery-e001", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // After non-zero exit: handleTakeIterationClose fetches beat state
    // Post-exit state fetch: beat is in active state (agent left it stuck)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e001",
        title: "Error retry test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // enforceQueueTerminalInvariant fetches: sees active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e001",
        title: "Error retry test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After invariant rollback, verify
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e001",
        title: "Error retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt (error retry) fetches beat state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e001",
        title: "Error retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    // Child exits with non-zero code (error)
    spawnedChildren[0].emit("close", 1, null);

    // Should spawn a second child (retry with different agent)
    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });
    expect(createLeaseMock).toHaveBeenCalledTimes(1);

    // Verify rollback was called
    expect(rollbackBeatState).toHaveBeenCalled();

    // Verify outcome stats were recorded
    expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.exitCode).toBe(1);
    expect(record.success).toBe(false);
    expect(record.beatId).toBe("foolery-e001");
  });

  it("non-zero exit stops when no alternate agent exists", async () => {
    // Take-loop with only one agent in the pool.
    loadSettingsMock.mockResolvedValue(advancedSettingsOneAgent);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e002",
        title: "No alternative agent test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e002", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Post-exit state: beat in queue state (no rollback needed)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e002",
        title: "No alternative agent test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // enforceQueueTerminalInvariant: already in queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e002",
        title: "No alternative agent test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt (error retry) fetches beat state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e002",
        title: "No alternative agent test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 1, null);

    // Session should finish without spawning a second child
    await waitFor(() => {
      expect(interactionLog.logEnd).toHaveBeenCalledWith(1, "error");
    });

    // No retry child spawned
    expect(spawnedChildren).toHaveLength(1);

    // Stats still recorded
    expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.success).toBe(false);
    expect(record.alternativeAgentAvailable).toBe(false);
    expect(record.rolledBack).toBe(false);
    expect(rollbackBeatState).not.toHaveBeenCalled();
  });

  it("records success=true when beat advances to next queue state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e003",
        title: "Success classification test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e003", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Post-exit: beat advanced to next queue state (implementation review)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e003",
        title: "Success classification test",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt fetches and sees the next queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e003",
        title: "Success classification test",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "next prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    // Wait for stats to be recorded
    await waitFor(() => {
      expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.success).toBe(true);
    expect(record.exitCode).toBe(0);
    expect(record.claimedState).toBe("ready_for_implementation");
    expect(record.postExitState).toBe("ready_for_implementation_review");
  });

  it("records success=true when beat moves to prior queue state (review rejection)", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    // Agent claims implementation_review step
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004",
        title: "Prior queue state success test",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e004", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Post-exit: beat moved to prior queue state (review rejected back to implementation)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004",
        title: "Prior queue state success test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt fetches and sees queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004",
        title: "Prior queue state success test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "next prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.success).toBe(true);
    expect(record.claimedState).toBe("ready_for_implementation_review");
    expect(record.postExitState).toBe("ready_for_implementation");
  });

  it("records success=false when beat stays at same queue state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    // Agent claims implementation step
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004b",
        title: "Same queue state failure test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e004b", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Post-exit: beat stayed at same queue state (no progress)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004b",
        title: "Same queue state failure test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt fetches and sees queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004b",
        title: "Same queue state failure test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "next prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.success).toBe(false);
    expect(record.postExitState).toBe("ready_for_implementation");
  });

  it("records success=false when beat reaches terminal state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004c",
        title: "Terminal state not success test",
        state: "ready_for_shipment_review",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e004c", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // Post-exit: beat reached terminal state (shipped)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004c",
        title: "Terminal state not success test",
        state: "shipped",
        isAgentClaimable: false,
      },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.success).toBe(false);
    expect(record.postExitState).toBe("shipped");
  });

  it("records success=false when beat is stuck in active state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005",
        title: "Active state failure test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e005", "/tmp/repo");

    // Post-exit: beat stuck in active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005",
        title: "Active state failure test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // buildNextTakePrompt sees active state, triggers step failure rollback
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005",
        title: "Active state failure test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After rollback, refresh
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005",
        title: "Active state failure test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true,
      data: { prompt: "retry prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    });

    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    // Exit code 0 but beat was in active state — classified as failure
    expect(record.success).toBe(false);
    expect(record.postExitState).toBe("implementation");
  });

  it("active-state rollback happens before retry on error exit", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006",
        title: "Rollback before retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "retry prompt" } });

    await createSession("foolery-e006", "/tmp/repo");

    // Post-exit: active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006",
        title: "Rollback before retry test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // enforceQueueTerminalInvariant sees active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006",
        title: "Rollback before retry test",
        state: "implementation",
        isAgentClaimable: false,
      },
    });
    // After rollback, verify
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006",
        title: "Rollback before retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt (error retry) sees queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006",
        title: "Rollback before retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 1, null);

    // Should rollback AND then spawn retry
    await waitFor(() => {
      expect(rollbackBeatState).toHaveBeenCalledWith(
        "foolery-e006",
        "implementation",
        "ready_for_implementation",
        "/tmp/repo",
        "knots",
      );
    });

    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });

    // Stats show rollback happened
    const record = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(record.rolledBack).toBe(true);
  });

  it("take-loop child error exit also retries with different agent", async () => {
    // Verify that the take-loop child (not just the initial child) uses
    // the same error-retry logic.
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        title: "Take-loop child retry test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "iteration prompt" },
    });

    await createSession("foolery-e007", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    // First child exits successfully (code 0) — triggers take-loop continuation
    // Post-exit state: advanced to next queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt sees the next queue state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 0, null);

    // Wait for second child to spawn
    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });

    // Second child (take-loop child) exits with error
    // Post-exit: active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "implementation_review",
        isAgentClaimable: false,
      },
    });
    // enforceQueueTerminalInvariant: active state
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "implementation_review",
        isAgentClaimable: false,
      },
    });
    // After rollback
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });
    // buildNextTakePrompt (error retry)
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review",
        isAgentClaimable: true,
      },
    });

    spawnedChildren[1].emit("close", 1, null);

    // Should spawn a third child (retry)
    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(3);
    });

    // Two outcome records: one for iteration 1 (success), one for iteration 2 (error)
    await waitFor(() => {
      expect((appendOutcomeRecord as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    });
  });
});

describe("agent-outcome-stats classification", () => {
  it("classifies next queue state as success", async () => {
    const { nextQueueStateForStep } = await import("@/lib/workflows");
    expect(nextQueueStateForStep("implementation")).toBe("ready_for_implementation_review");
    expect(nextQueueStateForStep("planning")).toBe("ready_for_plan_review");
    expect(nextQueueStateForStep("shipment_review")).toBeNull(); // last step
  });

  it("classifies prior queue state correctly", async () => {
    const { priorQueueStateForStep } = await import("@/lib/workflows");
    expect(priorQueueStateForStep("planning")).toBeNull(); // first step has no prior
    expect(priorQueueStateForStep("plan_review")).toBe("ready_for_planning");
    expect(priorQueueStateForStep("implementation")).toBe("ready_for_plan_review");
    expect(priorQueueStateForStep("implementation_review")).toBe("ready_for_implementation");
    expect(priorQueueStateForStep("shipment")).toBe("ready_for_implementation_review");
    expect(priorQueueStateForStep("shipment_review")).toBe("ready_for_shipment");
  });
});
