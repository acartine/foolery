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
  showKnot: vi.fn(async () => ({ ok: true, data: { lease_id: null } })),
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

vi.mock("@/lib/lease-audit", () => ({
  appendLeaseAuditEvent: vi.fn(async () => undefined),
  logLeaseAudit: vi.fn(),
}));

import { createSession } from "@/lib/terminal-manager";
import { appendLeaseAuditEvent } from "@/lib/lease-audit";

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

const advancedSettingsWithTwoAgents = {
  dispatchMode: "advanced",
  maxClaimsPerQueueType: 2,
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

const advancedSettingsWithThreeAgents = {
  ...advancedSettingsWithTwoAgents,
  maxClaimsPerQueueType: 10,
  pools: {
    planning: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
      { agentId: "agent-c", weight: 1 },
    ],
    plan_review: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
      { agentId: "agent-c", weight: 1 },
    ],
    implementation: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
      { agentId: "agent-c", weight: 1 },
    ],
    implementation_review: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
      { agentId: "agent-c", weight: 1 },
    ],
    shipment: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
      { agentId: "agent-c", weight: 1 },
    ],
    shipment_review: [
      { agentId: "agent-a", weight: 1 },
      { agentId: "agent-b", weight: 1 },
      { agentId: "agent-c", weight: 1 },
    ],
  },
  agents: {
    ...advancedSettingsWithTwoAgents.agents,
    "agent-c": {
      command: "gemini",
      label: "Gemini",
      model: "2.5-pro",
      version: "1.0",
    },
  },
};

const basicSettingsWithTwoAgents = {
  ...advancedSettingsWithTwoAgents,
  dispatchMode: "basic",
  maxClaimsPerQueueType: 10,
};

function mockClaimableBeat(
  beatData: {
    id: string;
    title: string;
    state: string;
    isAgentClaimable: boolean;
  },
): void {
  backend.get.mockResolvedValueOnce({
    ok: true,
    data: { ...beatData },
  });
  backend.listWorkflows.mockResolvedValue({
    ok: true, data: [],
  });
  backend.list.mockResolvedValue({
    ok: true, data: [],
  });
  backend.buildTakePrompt.mockResolvedValue({
    ok: true,
    data: { prompt: "prompt" },
  });
}

function keepBeatClaimable(
  beatData: {
    id: string;
    title: string;
    state: string;
    isAgentClaimable: boolean;
  },
): void {
  backend.get.mockResolvedValue({
    ok: true,
    data: { ...beatData },
  });
}

function expectConsoleLog(
  consoleSpy: ReturnType<typeof vi.spyOn>,
  expectedFragment: string,
): void {
  expect(consoleSpy).toHaveBeenCalledWith(
    expect.stringContaining(expectedFragment),
  );
}

function resetQueueClaimsMocks(): void {
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
  (appendLeaseAuditEvent as ReturnType<typeof vi.fn>).mockReset();
}

async function setupQueueClaimsMocks(): Promise<void> {
  resetQueueClaimsMocks();
  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockClear();

  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function clearQueueClaimsSessions(): void {
  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

describe("terminal-manager per-queue-type claim limits", () => {
  beforeEach(async () => {
    await setupQueueClaimsMocks();
  });

  afterEach(() => {
    clearQueueClaimsSessions();
  });

  describe("claim limit enforcement", () => {
    it("stops the take loop when per-queue-type claim limit is exceeded", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    const beatData = {
      id: "foolery-q001",
      title: "Queue claim limit test",
      state: "ready_for_implementation",
      isAgentClaimable: true,
    };

    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "iteration prompt" },
    });

    await createSession("foolery-q001", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValue({ ok: true, data: { ...beatData } });

    for (let i = 0; i < 2; i++) {
      const childIndex = spawnedChildren.length - 1;
      spawnedChildren[childIndex].emit("close", 0, null);
      await waitFor(() => {
        expect(spawnedChildren).toHaveLength(childIndex + 2);
      });
    }

    const lastChildIndex = spawnedChildren.length - 1;
    spawnedChildren[lastChildIndex].emit("close", 0, null);

    await waitFor(() => {
      expect(interactionLog.logEnd).toHaveBeenCalled();
    });

    expect(spawnedChildren).toHaveLength(3);
    });
  });

});

describe("queue claims: lease audit", () => {
  beforeEach(async () => {
    await setupQueueClaimsMocks();
  });

  afterEach(() => {
    clearQueueClaimsSessions();
  });

    it("emits lease audit events on successful claim", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    const beatData = {
      id: "foolery-q002",
      title: "Lease audit test",
      state: "ready_for_implementation",
      isAgentClaimable: true,
    };

    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "prompt" },
    });

    await createSession("foolery-q002", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValue({ ok: true, data: { ...beatData } });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });

    await waitFor(() => {
      expect(
        (appendLeaseAuditEvent as ReturnType<typeof vi.fn>)
          .mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
    });

    const laCalls = (
      appendLeaseAuditEvent as ReturnType<typeof vi.fn>
    ).mock.calls;
    const events = laCalls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );
    const claimEvents = events.filter(
      (e) => e.outcome === "claim",
    );
    const outcomeEvents = events.filter(
      (e) => e.outcome === "success" ||
        e.outcome === "fail",
    );
    expect(claimEvents.length).toBeGreaterThanOrEqual(1);
    expect(claimEvents[0]!.beatId).toBe("foolery-q002");
    expect(claimEvents[0]!.queueType)
      .toBe("implementation");
    expect(claimEvents[0]!.agent).toBeDefined();

    expect(outcomeEvents.length)
      .toBeGreaterThanOrEqual(1);
    expect(outcomeEvents[0]!.beatId)
      .toBe("foolery-q002");
    expect(
      typeof outcomeEvents[0]!.durationMs,
    ).toBe("number");
  });

  it("uses lastAgentPerQueueType as soft exclusion for agent rotation", async () => {
    loadSettingsMock.mockResolvedValue(advancedSettingsWithTwoAgents);

    const beatData = {
      id: "foolery-q003",
      title: "Agent rotation test",
      state: "ready_for_implementation",
      isAgentClaimable: true,
    };

    backend.get.mockResolvedValueOnce({ ok: true, data: { ...beatData } });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true,
      data: { prompt: "prompt" },
    });

    await createSession("foolery-q003", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValue({ ok: true, data: { ...beatData } });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });

    expect(appendLeaseAuditEvent).toHaveBeenCalled();
    });
});

describe("queue claims: repeated failure rotation", () => {
  beforeEach(async () => {
    await setupQueueClaimsMocks();
  });

  afterEach(() => {
    clearQueueClaimsSessions();
  });

  it(
    "rotates to a different pooled agent on error retry in basic mode",
    async () => {
      loadSettingsMock.mockResolvedValue(
        basicSettingsWithTwoAgents,
      );
      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const beatData = {
        id: "foolery-q004",
        title: "Basic mode error retry rotation",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      };

      mockClaimableBeat(beatData);
      await createSession("foolery-q004", "/tmp/repo");
      keepBeatClaimable(beatData);

      expect(spawnedChildren).toHaveLength(1);

      spawnedChildren[0].emit("close", 1, null);
      await waitFor(() => {
        expect(spawnedChildren).toHaveLength(2);
      });
      expectConsoleLog(consoleSpy, `selected="agent-b"`);

      spawnedChildren[1].emit("close", 1, null);
      await waitFor(() => {
        expect(interactionLog.logEnd).toHaveBeenCalled();
      });
      expect(spawnedChildren).toHaveLength(2);
      consoleSpy.mockRestore();
    },
  );

  it(
    "cycles through the full pool before stopping after repeated failures",
    async () => {
      loadSettingsMock.mockResolvedValue(
        advancedSettingsWithThreeAgents,
      );
      const randomSpy = vi
        .spyOn(Math, "random")
        .mockReturnValue(0);
      const consoleSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const beatData = {
        id: "foolery-q005",
        title: "Full pool rotation on repeated failures",
        state: "ready_for_implementation",
        isAgentClaimable: true,
      };

      mockClaimableBeat(beatData);
      await createSession("foolery-q005", "/tmp/repo");
      keepBeatClaimable(beatData);

      expect(spawnedChildren).toHaveLength(1);

      spawnedChildren[0].emit("close", 1, null);
      await waitFor(() => {
        expect(spawnedChildren).toHaveLength(2);
      });
      expectConsoleLog(consoleSpy, `selected="agent-b"`);

      spawnedChildren[1].emit("close", 1, null);
      await waitFor(() => {
        expect(spawnedChildren).toHaveLength(3);
      });
      expectConsoleLog(consoleSpy, `selected="agent-c"`);

      spawnedChildren[2].emit("close", 1, null);
      await waitFor(() => {
        expect(interactionLog.logEnd).toHaveBeenCalled();
      });
      expect(spawnedChildren).toHaveLength(3);
      randomSpy.mockRestore();
      consoleSpy.mockRestore();
    },
  );
});
