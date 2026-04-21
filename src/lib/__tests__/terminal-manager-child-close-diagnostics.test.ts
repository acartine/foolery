/**
 * Integration lock (foolery-e750): asserts that when
 * the take-loop child closes, the enriched diagnostic
 * fields flow into the recorded lifecycle payload AND
 * into the human-readable console log line.
 *
 * This prevents a silent regression where the child
 * close log drops the signal/exitReason fields again.
 */
import { EventEmitter } from "node:events";
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";

const nextKnotMock = vi.fn();
const nextBeatMock = vi.fn();
const resolveMemoryManagerTypeMock = vi.fn(
  () => "knots",
);
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
  logLifecycle: vi.fn(),
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
    child.pid = 5555;
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
  resolveInteractionLogRoot:
    vi.fn(() => "/tmp/foolery-logs"),
  startInteractionLog:
    vi.fn(async () => interactionLog),
  noopInteractionLog: vi.fn(() => interactionLog),
}));

vi.mock("@/lib/knots", () => ({
  nextKnot: (...args: unknown[]) =>
    nextKnotMock(...args),
  createLease: (...args: unknown[]) =>
    createLeaseMock(...args),
  terminateLease: (...args: unknown[]) =>
    terminateLeaseMock(...args),
  showKnot: vi.fn(
    async () => ({ ok: true, data: { lease_id: null } }),
  ),
}));

vi.mock("@/lib/lease-audit", () => ({
  appendLeaseAuditEvent:
    vi.fn(async () => undefined),
  logLeaseAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/beads-state-machine", () => ({
  nextBeat: (...args: unknown[]) =>
    nextBeatMock(...args),
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
  resolveMemoryManagerType: () =>
    resolveMemoryManagerTypeMock(),
  buildShowIssueCommand: vi.fn(
    (id: string) => `kno show ${JSON.stringify(id)}`,
  ),
  buildClaimCommand: vi.fn(
    (id: string) =>
      `kno claim ${JSON.stringify(id)} --json`,
  ),
  buildWorkflowStateCommand: vi.fn(
    (id: string, state: string) =>
      `kno next ${JSON.stringify(id)} ` +
      `--expected-state ${JSON.stringify(state)}` +
      ` --actor-kind agent`,
  ),
  rollbackBeatState: vi.fn(async () => undefined),
  assertClaimable: vi.fn(),
  supportsAutoFollowUp: vi.fn(() => false),
}));

vi.mock("@/lib/validate-cwd", () => ({
  validateCwd: vi.fn(async () => null),
}));

vi.mock("@/lib/agent-message-type-index", () => ({
  updateMessageTypeIndexFromSession:
    vi.fn(async () => undefined),
}));

import {
  abortSession,
  createSession,
} from "@/lib/terminal-manager";

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

function resetMocks(): void {
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
  interactionLog.logLifecycle.mockReset();
  interactionLog.logStdout.mockReset();
  interactionLog.logStderr.mockReset();
  interactionLog.logResponse.mockReset();
  interactionLog.logBeatState.mockReset();
  interactionLog.logEnd.mockReset();
}

function clearSessions(): void {
  type GS = {
    __terminalSessions?: Map<string, unknown>;
  };
  const sessions =
    (globalThis as GS).__terminalSessions;
  for (const sessionId of sessions?.keys() ?? []) {
    abortSession(sessionId);
  }
  sessions?.clear();
}

async function setupDiagTest(): Promise<void> {
  resetMocks();
  const { exec } =
    await import("node:child_process");
  (exec as unknown as ReturnType<typeof vi.fn>)
    .mockClear();
  type GS = {
    __terminalSessions?: Map<string, unknown>;
  };
  const sessions =
    (globalThis as GS).__terminalSessions;
  sessions?.clear();

  backend.get.mockResolvedValue({
    ok: true,
    data: {
      id: "foolery-e750-diag",
      title: "Child close diagnostics",
      state: "ready_for_implementation",
      isAgentClaimable: true,
    },
  });
  backend.listWorkflows.mockResolvedValue({
    ok: true, data: [],
  });
  backend.list.mockResolvedValue({
    ok: true, data: [],
  });
  backend.buildTakePrompt
    .mockResolvedValueOnce({
      ok: true, data: { prompt: "diag prompt" },
    })
    .mockResolvedValue({ ok: false, error: "stop" });
}

function findSigTermCloseCall():
  Record<string, unknown> | undefined {
  return interactionLog.logLifecycle.mock.calls
    .map(
      (args: unknown[]) =>
        args[0] as Record<string, unknown>,
    )
    .find(
      (e) =>
        e.event === "child_close" &&
        e.childSignal === "SIGTERM",
    );
}

function findCloseLine(
  logSpy: ReturnType<typeof vi.spyOn>,
): string | undefined {
  return logSpy.mock.calls
    .map(
      (args: unknown[]) =>
        args.map((a) => String(a)).join(" "),
    )
    .find(
      (line: string) =>
        line.includes("child close:") &&
        line.includes("take-loop"),
    );
}

async function drainRemainingChildren(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
  for (const c of spawnedChildren) {
    if (!c.killed) c.emit("close", 0, null);
  }
  await new Promise((r) => setTimeout(r, 10));
}

describe("take-loop: child_close diagnostics", () => {
  beforeEach(async () => { await setupDiagTest(); });
  afterEach(() => { clearSessions(); });

  it(
    "records signal, exitReason, ms, lastEventType on payload",
    async () => {
      const session = await createSession(
        "foolery-e750-diag", "/tmp/repo",
      );
      expect(spawnedChildren).toHaveLength(1);
      const child = spawnedChildren[0];
      child.stdout.emit(
        "data",
        Buffer.from(
          '{"type":"result","is_error":false}\n',
        ),
      );
      await new Promise((r) => setImmediate(r));
      child.emit("close", 0, "SIGTERM");

      await waitFor(() => {
        const call = findSigTermCloseCall();
        expect(call).toBeDefined();
        expect(call!.childSignal).toBe("SIGTERM");
        expect(typeof call!.exitReason).toBe("string");
        expect(
          typeof call!.msSinceLastStdout,
        ).toBe("number");
        expect(call).toHaveProperty("lastEventType");
      });
      abortSession(session.id);
      await drainRemainingChildren();
    },
  );

  it(
    "prints signal= and msSinceLastStdout= in log line",
    async () => {
      const logSpy = vi.spyOn(console, "log")
        .mockImplementation(() => undefined);
      try {
        const session = await createSession(
          "foolery-e750-diag", "/tmp/repo",
        );
        expect(spawnedChildren).toHaveLength(1);
        const child = spawnedChildren[0];
        child.stdout.emit(
          "data",
          Buffer.from("some output\n"),
        );
        await new Promise((r) => setImmediate(r));
        child.emit("close", 0, "SIGTERM");

        await waitFor(() => {
          const line = findCloseLine(logSpy);
          expect(line).toBeDefined();
          expect(line).toContain("signal=SIGTERM");
          expect(line).toContain("msSinceLastStdout=");
          expect(line).toContain("exitReason=");
          expect(line).toContain("lastEventType=");
        });
        abortSession(session.id);
        await drainRemainingChildren();
      } finally {
        logSpy.mockRestore();
      }
    },
  );
});
