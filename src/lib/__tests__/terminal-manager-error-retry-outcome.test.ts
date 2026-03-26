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
    command: "claude", label: "Claude",
    agentId: "agent-a", model: "opus", version: "4.6",
  })),
  getStepAgent: vi.fn(async () => ({
    command: "claude", label: "Claude",
    agentId: "agent-a", model: "opus", version: "4.6",
  })),
  loadSettings: (...args: unknown[]) => loadSettingsMock(...args),
}));

vi.mock("@/lib/memory-manager-commands", () => ({
  resolveMemoryManagerType: () => resolveMemoryManagerTypeMock(),
  buildShowIssueCommand: vi.fn((id: string) => `kno show ${JSON.stringify(id)}`),
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

describe("agent-outcome-stats classification via terminal-manager", () => {
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

    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  it("records success=true when beat advances to next queue state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e003", title: "Success classification test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e003", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e003", title: "Success classification test",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e003", title: "Success classification test",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "next prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      const aoFn = appendOutcomeRecord as ReturnType<typeof vi.fn>;
    expect(aoFn).toHaveBeenCalledTimes(1);
    });

    const aoCalls = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls;
    const record = aoCalls[0]![0] as Record<string, unknown>;
    expect(record.success).toBe(true);
    expect(record.exitCode).toBe(0);
    expect(record.claimedState).toBe("ready_for_implementation");
    expect(record.postExitState).toBe("ready_for_implementation_review");
  });

  it("records success=true when beat moves to prior queue state (review rejection)", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004", title: "Prior queue state success test",
        state: "ready_for_implementation_review", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e004", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004", title: "Prior queue state success test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004", title: "Prior queue state success test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "next prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      const aoFn = appendOutcomeRecord as ReturnType<typeof vi.fn>;
    expect(aoFn).toHaveBeenCalledTimes(1);
    });

    const aoCalls = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls;
    const record = aoCalls[0]![0] as Record<string, unknown>;
    expect(record.success).toBe(true);
    expect(record.claimedState).toBe("ready_for_implementation_review");
    expect(record.postExitState).toBe("ready_for_implementation");
  });

  it("records success=false when beat stays at same queue state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004b", title: "Same queue state failure test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e004b", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004b", title: "Same queue state failure test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004b", title: "Same queue state failure test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "next prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      const aoFn = appendOutcomeRecord as ReturnType<typeof vi.fn>;
    expect(aoFn).toHaveBeenCalledTimes(1);
    });

    const aoCalls = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls;
    const record = aoCalls[0]![0] as Record<string, unknown>;
    expect(record.success).toBe(false);
    expect(record.postExitState).toBe("ready_for_implementation");
  });

  it("records success=false when beat reaches terminal state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004c", title: "Terminal state not success test",
        state: "ready_for_shipment_review", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e004c", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e004c", title: "Terminal state not success test",
        state: "shipped", isAgentClaimable: false,
      },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      const aoFn = appendOutcomeRecord as ReturnType<typeof vi.fn>;
    expect(aoFn).toHaveBeenCalledTimes(1);
    });

    const aoCalls = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls;
    const record = aoCalls[0]![0] as Record<string, unknown>;
    expect(record.success).toBe(false);
    expect(record.postExitState).toBe("shipped");
  });

  it("records success=false when beat is stuck in active state", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005", title: "Active state failure test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "initial prompt" },
    });

    await createSession("foolery-e005", "/tmp/repo");

    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005", title: "Active state failure test",
        state: "implementation", isAgentClaimable: false,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005", title: "Active state failure test",
        state: "implementation", isAgentClaimable: false,
      },
    });
    backend.get.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "foolery-e005", title: "Active state failure test",
        state: "ready_for_implementation", isAgentClaimable: true,
      },
    });
    backend.buildTakePrompt.mockResolvedValueOnce({
      ok: true, data: { prompt: "retry prompt" },
    });

    spawnedChildren[0].emit("close", 0, null);

    await waitFor(() => {
      const aoFn = appendOutcomeRecord as ReturnType<typeof vi.fn>;
    expect(aoFn).toHaveBeenCalledTimes(1);
    });

    const aoCalls = (appendOutcomeRecord as ReturnType<typeof vi.fn>).mock.calls;
    const record = aoCalls[0]![0] as Record<string, unknown>;
    expect(record.success).toBe(false);
    expect(record.postExitState).toBe("implementation");
  });
});

describe("agent-outcome-stats classification", () => {
  it("classifies next queue state as success", async () => {
    const { nextQueueStateForStep } = await import("@/lib/workflows");
    expect(nextQueueStateForStep("implementation")).toBe(
      "ready_for_implementation_review",
    );
    expect(nextQueueStateForStep("planning")).toBe("ready_for_plan_review");
    expect(nextQueueStateForStep("shipment_review")).toBeNull();
  });

  it("classifies prior queue state correctly", async () => {
    const { priorQueueStateForStep } = await import("@/lib/workflows");
    expect(priorQueueStateForStep("planning")).toBeNull();
    expect(priorQueueStateForStep("plan_review")).toBe("ready_for_planning");
    expect(priorQueueStateForStep("implementation")).toBe("ready_for_plan_review");
    expect(priorQueueStateForStep("implementation_review")).toBe(
      "ready_for_implementation",
    );
    expect(priorQueueStateForStep("shipment")).toBe(
      "ready_for_implementation_review",
    );
    expect(priorQueueStateForStep("shipment_review")).toBe("ready_for_shipment");
  });
});
