import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveMemoryManagerTypeMock = vi.fn(() => "knots");
const validateCwdMock = vi.fn<(cwd?: string) => Promise<string | null>>(async () => null);
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
  createLease: (...args: unknown[]) => createLeaseMock(...args),
  terminateLease: (...args: unknown[]) => terminateLeaseMock(...args),
}));

vi.mock("@/lib/lease-audit", () => ({
  appendLeaseAuditEvent: vi.fn(async () => undefined),
  logLeaseAudit: vi.fn(async () => undefined),
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
        model: "gpt-5.4-codex",
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
  buildShowIssueCommand: vi.fn(),
  buildClaimCommand: vi.fn(),
  buildWorkflowStateCommand: vi.fn(),
  rollbackBeatState: vi.fn(async () => undefined),
  assertClaimable: vi.fn(),
  supportsAutoFollowUp: vi.fn(() => false),
}));

vi.mock("@/lib/validate-cwd", () => ({
  validateCwd: (cwd?: string) => validateCwdMock(cwd),
}));

vi.mock("@/lib/agent-message-type-index", () => ({
  updateMessageTypeIndexFromSession: vi.fn(async () => undefined),
}));

vi.mock("@/lib/agent-outcome-stats", () => ({
  appendOutcomeRecord: vi.fn(async () => undefined),
}));

import { createSession, getSession } from "@/lib/terminal-manager";

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

describe("terminal-manager Knots lease integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnedChildren.length = 0;
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    validateCwdMock.mockResolvedValue(null);
    createLeaseMock.mockResolvedValue({ ok: true, data: { id: "lease-k1" } });
    terminateLeaseMock.mockResolvedValue({ ok: true });
    backend.get.mockReset();
    backend.list.mockReset();
    backend.listWorkflows.mockReset();
    backend.buildTakePrompt.mockReset();
    backend.update.mockReset();

    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    type GS = { __terminalSessions?: Map<string, unknown> };
    const sessions = (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  it("creates and terminates a Knots lease for a single-beat session", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "beat-1",
        title: "Lease me",
        state: "ready_for_implementation",
        isAgentClaimable: true,
        labels: [],
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({ ok: true, data: { prompt: "do the work" } });

    const session = await createSession("beat-1", "/tmp/repo");
    expect(createLeaseMock).toHaveBeenCalledOnce();
    expect(getSession(session.id)?.knotsLeaseId).toBe("lease-k1");

    spawnedChildren[0].emit("close", 0, "SIGTERM");

    await waitFor(() => {
      expect(spawnedChildren).toHaveLength(2);
    });

    getSession(session.id)?.abort?.();
    spawnedChildren[1].emit("close", 0, "SIGTERM");

    await waitFor(() => {
      expect(terminateLeaseMock).toHaveBeenCalledWith("lease-k1", "/tmp/repo");
      expect(getSession(session.id)?.knotsLeaseId).toBeUndefined();
    });
  });

  it("does not create a Knots lease for scene sessions", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "parent-1",
        title: "Parent",
        state: "ready_for_implementation",
        isAgentClaimable: true,
        labels: ["wave"],
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "child-1",
          title: "Child",
          state: "ready_for_implementation",
          isAgentClaimable: true,
          labels: [],
        },
      ],
    });
    backend.buildTakePrompt.mockResolvedValue({ ok: true, data: { prompt: "scene prompt" } });

    await createSession("parent-1", "/tmp/repo");

    expect(createLeaseMock).not.toHaveBeenCalled();
  });

  it("terminates a created lease when cwd validation fails", async () => {
    validateCwdMock.mockResolvedValue("cwd missing");
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "beat-2",
        title: "Bad cwd",
        state: "ready_for_implementation",
        isAgentClaimable: true,
        labels: [],
      },
    });
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });
    backend.buildTakePrompt.mockResolvedValue({ ok: true, data: { prompt: "prompt" } });

    await createSession("beat-2", "/tmp/repo");

    await waitFor(() => {
      expect(createLeaseMock).toHaveBeenCalledOnce();
      expect(terminateLeaseMock).toHaveBeenCalledWith("lease-k1", "/tmp/repo");
    });
  });

});

describe("terminal-manager: canonical lease metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnedChildren.length = 0;
    resolveMemoryManagerTypeMock.mockReturnValue("knots");
    validateCwdMock.mockResolvedValue(null);
    createLeaseMock.mockResolvedValue({
      ok: true, data: { id: "lease-k1" },
    });
    terminateLeaseMock.mockResolvedValue({ ok: true });
    backend.get.mockReset();
    backend.list.mockReset();
    backend.listWorkflows.mockReset();
    backend.buildTakePrompt.mockReset();
    backend.update.mockReset();

    type GS = {
      __terminalSessions?: Map<string, unknown>;
    };
    const sessions =
      (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    type GS = {
      __terminalSessions?: Map<string, unknown>;
    };
    const sessions =
      (globalThis as GS).__terminalSessions;
    sessions?.clear();
  });

  it("passes canonical agent metadata to lease creation", async () => {
    backend.get.mockResolvedValue({
      ok: true,
      data: {
        id: "beat-3",
        title: "Canonical test",
        state: "ready_for_implementation",
        isAgentClaimable: true,
        labels: [],
      },
    });
    backend.listWorkflows.mockResolvedValue({
      ok: true, data: [],
    });
    backend.list.mockResolvedValue({
      ok: true, data: [],
    });
    backend.buildTakePrompt.mockResolvedValue({
      ok: true, data: { prompt: "test prompt" },
    });

    await createSession("beat-3", "/tmp/repo");

    expect(createLeaseMock).toHaveBeenCalledOnce();
    const leaseOpts = createLeaseMock.mock.calls[0][0];
    // The mock agent is { command: "codex", label: "Codex",
    //   model: "gpt-5.4-codex" }. Canonical identity drops
    // the display label and derives `agent_name` from the
    // command — so leaseOpts.agentName is "Codex" (from
    // displayCommandLabel("codex")), not from the label
    // field. Both happen to render "Codex" here, but the
    // value comes from canonical resolution.
    expect(leaseOpts.agentName).toBe("Codex");
    expect(leaseOpts.agentType).toBe("cli");
    expect(leaseOpts.provider).toBe("Codex");
  });
});
