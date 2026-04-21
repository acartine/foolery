/**
 * Terminal manager knots next guard: rollback and prompt wrapping tests.
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

const { stubDispatchSettings } = vi.hoisted(() => {
  const pool = [{ agentId: "codex", weight: 1 }];
  const settings = {
    dispatchMode: "advanced",
    agents: {
      codex: {
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
    stubDispatchSettings: (): Record<string, unknown> => ({ ...settings }),
  };
});

vi.mock("@/lib/settings", () => ({
  loadSettings: vi.fn(async () => stubDispatchSettings()),
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

import { createSession } from "@/lib/terminal-manager";
import { rollbackBeatState } from "@/lib/memory-manager-commands";

function resetRollbackMocks(): void {
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
}

async function setupRollbackMocks(): Promise<void> {
  resetRollbackMocks();
  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockClear();

  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

function clearRollbackSessions(): void {
  type GS = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GS).__terminalSessions;
  sessions?.clear();
}

describe("terminal-manager nextKnot guard: rollback and prompts", () => {
  beforeEach(async () => {
    await setupRollbackMocks();
  });

  afterEach(() => {
    clearRollbackSessions();
  });

  describe("rollback from active to queue state", () => {
    it("rolls back active knot to queue state instead of advancing", async () => {
    backend.get
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d4", title: "Fix double kno-next",
          state: "implementation", isAgentClaimable: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d4", title: "Fix double kno-next",
          state: "ready_for_implementation", isAgentClaimable: true,
        },
      });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-e6d4", "/tmp/repo", "custom prompt");

    expect(nextKnotMock).not.toHaveBeenCalled();
    expect(backend.get).toHaveBeenCalledTimes(2);
    expect(rollbackBeatState).toHaveBeenCalledWith(
      "foolery-e6d4", "implementation", "ready_for_implementation",
      "/tmp/repo", "knots", expect.any(String),
    );
  });

  it("rolls back active beads-managed beat to queue state", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    backend.update.mockResolvedValue({ ok: true });
    backend.get
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d5", title: "Fix double bd-next",
          state: "implementation", isAgentClaimable: false,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "foolery-e6d5", title: "Fix double bd-next",
          state: "ready_for_implementation", isAgentClaimable: true,
        },
      });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession("foolery-e6d5", "/tmp/repo", "custom prompt");

    expect(nextBeatMock).not.toHaveBeenCalled();
    expect(nextKnotMock).not.toHaveBeenCalled();
    expect(rollbackBeatState).toHaveBeenCalledWith(
      "foolery-e6d5", "implementation", "ready_for_implementation",
      "/tmp/repo", "beads", expect.any(String),
    );
    });
  });

});

function mockRollbackBeat(
  id: string, title: string, state: string, claimable = true,
): { ok: true; data: Record<string, unknown> } {
  return {
    ok: true,
    data: { id, title, state, isAgentClaimable: claimable },
  };
}

function setupPromptLoggingBackend(
  id: string, title: string,
): void {
  backend.get.mockResolvedValue(mockRollbackBeat(
    id, title, "ready_for_implementation",
  ));
  backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
}

describe("nextKnot guard: prompt logging (one-shot)", () => {
  beforeEach(async () => { await setupRollbackMocks(); });
  afterEach(() => { clearRollbackSessions(); });

  it("logs initial prompt for one-shot agents", async () => {
    setupPromptLoggingBackend("foolery-1000", "Record prompt history");
    backend.list.mockResolvedValue({ ok: true, data: [] });

    await createSession(
      "foolery-1000", "/tmp/repo", "show this prompt in history",
    );
    expect(spawnedChildren).toHaveLength(1);
    expect(interactionLog.logPrompt).toHaveBeenCalledWith(
      "show this prompt in history", { source: "initial" },
    );
  });

  it("wraps app-generated initial prompt for scene sessions", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    setupPromptLoggingBackend("foolery-3000", "Scene prompt visibility");
    backend.list.mockResolvedValue({
      ok: true,
      data: [mockRollbackBeat(
        "foolery-3001", "Child beat", "ready_for_implementation",
      ).data],
    });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true, data: { prompt: "scene app prompt" },
    });

    await createSession("foolery-3000", "/tmp/repo");
    expect(spawnedChildren).toHaveLength(1);
    expect(interactionLog.logPrompt).toHaveBeenCalledTimes(1);
    const initialPrompt = interactionLog.logPrompt.mock.calls[0]?.[0];
    expect(typeof initialPrompt).toBe("string");
    expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
    expect(initialPrompt).toContain(
      "Execute only the child beats explicitly listed below.",
    );
    expect(initialPrompt).toContain("scene app prompt");
    expect(interactionLog.logPrompt).toHaveBeenCalledWith(
      initialPrompt, { source: "initial" },
    );
  });
});

describe("nextKnot guard: prompt wrapping (parent and beads)", () => {
  beforeEach(async () => { await setupRollbackMocks(); });
  afterEach(() => { clearRollbackSessions(); });

  it("wraps knots parent prompt as Scene", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    setupPromptLoggingBackend("foolery-3050", "Knots parent beat");
    backend.list.mockResolvedValue({
      ok: true,
      data: [mockRollbackBeat(
        "foolery-3051", "Child knot", "ready_for_implementation",
      ).data],
    });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true, data: { prompt: "knots parent prompt" },
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
    expect(initialPrompt).toContain(
      "Execute only the child beats explicitly listed below.",
    );
    expect(initialPrompt).not.toContain(
      "Execute only the currently assigned workflow action",
    );
    expect(initialPrompt).toContain("knots parent prompt");
  });

  it("wraps backend prompt for beads-managed beats", async () => {
    resolveMemoryManagerTypeMock.mockReturnValue("beads");
    setupPromptLoggingBackend("foolery-3100", "Beads prompt visibility");
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true, data: { prompt: "beads app prompt" },
    });

    await createSession("foolery-3100", "/tmp/repo");
    const initialPrompt = interactionLog.logPrompt.mock.calls[0]?.[0];
    expect(typeof initialPrompt).toBe("string");
    expect(initialPrompt).toContain("FOOLERY EXECUTION BOUNDARY:");
    expect(initialPrompt).toContain(
      "Execute only the currently assigned workflow action",
    );
    expect(initialPrompt).toContain("beads app prompt");
    expect(interactionLog.logPrompt).toHaveBeenCalledWith(
      initialPrompt, { source: "initial" },
    );
  });
});
