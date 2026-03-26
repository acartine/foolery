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
    implementation_review: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
    ],
    shipment: [{ agentId: "agent-a", weight: 1 }, { agentId: "agent-b", weight: 1 }],
    shipment_review: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
    ],
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

function resetAllMocks(): void {
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
  (rollbackBeatState as ReturnType<typeof vi.fn>).mockClear();
}

async function setupRetryMocks(): Promise<void> {
  resetAllMocks();
  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockClear();

  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function clearRetrySessions(): void {
  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function mockRetryBeat(
  id: string, title: string, state: string, claimable = true,
): { ok: true; data: Record<string, unknown> } {
  return {
    ok: true,
    data: { id, title, state, isAgentClaimable: claimable },
  };
}

function getOutcomeRecord(): Record<string, unknown> {
  const aoFn = appendOutcomeRecord as ReturnType<typeof vi.fn>;
  expect(aoFn).toHaveBeenCalledTimes(1);
  return aoFn.mock.calls[0]![0] as Record<string, unknown>;
}

describe("error-exit retry: retries with alternative agent", () => {
  beforeEach(async () => { await setupRetryMocks(); });
  afterEach(() => { clearRetrySessions(); });

  it("non-zero exit retries with different agent when alternative exists", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e001", "Error retry test",
      "ready_for_implementation",
    ));
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "retry prompt" } });

    await createSession("foolery-e001", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e001", "Error retry test", "implementation", false,
    ));
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e001", "Error retry test", "implementation", false,
    ));
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e001", "Error retry test", "ready_for_implementation",
    ));
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e001", "Error retry test", "ready_for_implementation",
    ));

    spawnedChildren[0].emit("close", 1, null);

    await waitFor(() => { expect(spawnedChildren).toHaveLength(2); });
    expect(createLeaseMock).toHaveBeenCalledTimes(2);
    expect(rollbackBeatState).toHaveBeenCalled();

    const record = getOutcomeRecord();
    expect(record.exitCode).toBe(1);
    expect(record.success).toBe(false);
    expect(record.beatId).toBe("foolery-e001");
  });
});

describe("error-exit retry: stops when no alternative agent", () => {
  beforeEach(async () => { await setupRetryMocks(); });
  afterEach(() => { clearRetrySessions(); });

  it("non-zero exit stops when no alternate agent exists", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsOneAgent);
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e002", "No alternative agent test",
      "ready_for_implementation",
    ));
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e002", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e002", "No alternative agent test",
      "ready_for_implementation",
    ));
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e002", "No alternative agent test",
      "ready_for_implementation",
    ));
    backend.get.mockResolvedValueOnce(mockRetryBeat(
      "foolery-e002", "No alternative agent test",
      "ready_for_implementation",
    ));

    spawnedChildren[0].emit("close", 1, null);

    await waitFor(() => {
      expect(interactionLog.logEnd).toHaveBeenCalledWith(1, "error");
    });
    expect(spawnedChildren).toHaveLength(1);

    const record = getOutcomeRecord();
    expect(record.success).toBe(false);
    expect(record.alternativeAgentAvailable).toBe(false);
    expect(record.rolledBack).toBe(false);
    expect(rollbackBeatState).not.toHaveBeenCalled();
  });
});

describe("error-exit retry: rollback before retry", () => {
  beforeEach(async () => {
    await setupRetryMocks();
  });

  afterEach(() => {
    clearRetrySessions();
  });

  describe("rollback before retry", () => {
    it("active-state rollback happens before retry on error exit", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006", title: "Rollback before retry test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt
      .mockResolvedValueOnce({ ok: true, data: { prompt: "initial prompt" } })
      .mockResolvedValueOnce({ ok: true, data: { prompt: "retry prompt" } });

    await createSession("foolery-e006", "/tmp/repo");

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006", title: "Rollback before retry test",
        state: "implementation", isAgentClaimable: false,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006", title: "Rollback before retry test",
        state: "implementation", isAgentClaimable: false,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006", title: "Rollback before retry test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e006", title: "Rollback before retry test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 1, null);

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

    const aoCalls = (
      appendOutcomeRecord as ReturnType<typeof vi.fn>
    ).mock.calls;
    const record = aoCalls[0]![0] as Record<string, unknown>;
    expect(record.rolledBack).toBe(true);
    });
  });

});

describe("error-exit retry: take-loop child retry", () => {
  beforeEach(async () => {
    await setupRetryMocks();
  });

  afterEach(() => {
    clearRetrySessions();
  });

  describe("take-loop child retry", () => {
    it("take-loop child error exit also retries with different agent", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007", title: "Take-loop child retry test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true, data: { prompt: "iteration prompt" },
    });

    await createSession("foolery-e007", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "implementation_review", isAgentClaimable: false,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "implementation_review", isAgentClaimable: false,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e007",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });

    spawnedChildren[1].emit("close", 1, null);

    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(3);
    });

    await waitFor(() => {
      expect(
        (appendOutcomeRecord as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledTimes(2);
      });
    });
  });
});
