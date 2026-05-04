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
    _cmd: string,
    _opts: unknown,
    cb?: (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    if (cb) {
      cb(null, { stdout: "", stderr: "" });
    }
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
    actions: { take: "", scene: "", scopeRefinement: "", staleGrooming: "" },
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

import {
  createSession,
  getSession,
  killSession,
  terminateSession,
} from "@/lib/terminal-manager";

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
    } catch (error) {
      if (Date.now() - start >= timeout) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

function resetSignalMocks(): void {
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

async function setupSignalMocks(): Promise<void> {
  resetSignalMocks();
  const { exec } = await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>).mockClear();

  type GlobalState = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GlobalState).__terminalSessions;
  sessions?.clear();
}

function clearSignalSessions(): void {
  type GlobalState = { __terminalSessions?: Map<string, unknown> };
  const sessions = (globalThis as GlobalState).__terminalSessions;
  sessions?.clear();
}

async function createRunningSession(beatId: string) {
  backend.get.mockResolvedValue({
    ok: true,
    data: {
      id: beatId,
      title: `Terminal signal ${beatId}`,
      state: "ready_for_implementation",
      isAgentClaimable: true,
    },
  });
  backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
  backend.list.mockResolvedValue({ ok: true, data: [] });

  return createSession(beatId, "/tmp/repo", "custom prompt");
}

describe("terminal-manager signal behavior", () => {
  beforeEach(async () => {
    await setupSignalMocks();
  });

  afterEach(() => {
    clearSignalSessions();
    vi.restoreAllMocks();
  });

  it("terminateSession sends SIGTERM and marks the session aborted", async () => {
    const processKillSpy = vi.spyOn(process, "kill")
      .mockImplementation((target, signal) => {
        expect(target).toBe(-4321);
        expect(signal).toBe("SIGTERM");
        return true;
      });

    const session = await createRunningSession("foolery-s001");
    const result = terminateSession(session.id);

    expect(result).toEqual({
      ok: true,
      session: expect.objectContaining({
        id: session.id,
        status: "aborted",
      }),
    });
    expect(processKillSpy).toHaveBeenCalledOnce();
    expect(spawnedChildren[0]?.kill).not.toHaveBeenCalled();
    expect(getSession(session.id)?.session.status).toBe("aborted");
  });

  it("killSession sends SIGKILL and marks the session aborted", async () => {
    const processKillSpy = vi.spyOn(process, "kill")
      .mockImplementation((target, signal) => {
        expect(target).toBe(-4321);
        expect(signal).toBe("SIGKILL");
        return true;
      });

    const session = await createRunningSession("foolery-s002");
    const result = killSession(session.id);

    expect(result).toEqual({
      ok: true,
      session: expect.objectContaining({
        id: session.id,
        status: "aborted",
      }),
    });
    expect(processKillSpy).toHaveBeenCalledOnce();
    expect(spawnedChildren[0]?.kill).not.toHaveBeenCalled();
    expect(getSession(session.id)?.session.status).toBe("aborted");
  });

  it("terminateSession returns not_found when the session id is unknown", () => {
    expect(terminateSession("missing-session")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("terminateSession returns already_exited when the process has already finished", async () => {
    const processKillSpy = vi.spyOn(process, "kill");
    const session = await createRunningSession("foolery-s003");

    spawnedChildren[0]?.emit("close", 0, null);

    await waitFor(() => {
      expect(getSession(session.id)?.session.status).toBe("completed");
    });

    expect(terminateSession(session.id)).toEqual({
      ok: false,
      reason: "already_exited",
      status: "completed",
    });
    expect(processKillSpy).not.toHaveBeenCalled();
  });
});
