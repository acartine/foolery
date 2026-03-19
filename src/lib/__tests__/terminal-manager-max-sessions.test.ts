import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadSettingsMock } = vi.hoisted(() => ({
  loadSettingsMock: vi.fn<
    () => Promise<{ dispatchMode: string; maxConcurrentSessions?: number }>
  >(async () => ({
    dispatchMode: "single",
    maxConcurrentSessions: 5,
  })),
}));

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { writable: boolean; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  pid: number;
};

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
    child.kill = vi.fn(() => true);
    child.pid = 4321;
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
  nextKnot: vi.fn(),
  terminateLease: vi.fn(),
}));

vi.mock("@/lib/beads-state-machine", () => ({
  nextBeat: vi.fn(),
}));

vi.mock("@/lib/regroom", () => ({
  regroomAncestors: vi.fn(async () => undefined),
}));

vi.mock("@/lib/settings", () => ({
  getActionAgent: vi.fn(async () => ({ command: "codex", label: "Codex" })),
  getStepAgent: vi.fn(async () => ({ command: "codex", label: "Codex" })),
  loadSettings: loadSettingsMock,
}));

vi.mock("@/lib/memory-manager-commands", () => ({
  resolveMemoryManagerType: vi.fn(() => "knots"),
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

import { createSession } from "@/lib/terminal-manager";

describe("terminal-manager max concurrent sessions", () => {
  beforeEach(() => {
    loadSettingsMock.mockReset();
    loadSettingsMock.mockResolvedValue({
      dispatchMode: "single",
      maxConcurrentSessions: 1,
    });
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

    backend.get.mockImplementation(async (id: string) => ({
      ok: true,
      data: {
        id,
        title: `Beat ${id}`,
        state: "ready_for_implementation",
        isAgentClaimable: true,
      },
    }));
    backend.listWorkflows.mockResolvedValue({ ok: true, data: [] });
    backend.list.mockResolvedValue({ ok: true, data: [] });

    const sessions = (globalThis as { __terminalSessions?: Map<string, unknown> }).__terminalSessions;
    sessions?.clear();
  });

  afterEach(() => {
    const sessions = (globalThis as { __terminalSessions?: Map<string, unknown> }).__terminalSessions;
    sessions?.clear();
  });

  it("enforces the configured session limit", async () => {
    await createSession("foolery-limit-1", "/tmp/repo", "custom prompt");

    await expect(
      createSession("foolery-limit-2", "/tmp/repo", "custom prompt"),
    ).rejects.toThrow("Max concurrent sessions (1) reached");
  });

  it("falls back to the default session limit when the setting is absent", async () => {
    loadSettingsMock.mockResolvedValue({ dispatchMode: "single" });

    for (let index = 0; index < 5; index += 1) {
      await createSession(`foolery-default-${index}`, "/tmp/repo", "custom prompt");
    }

    await expect(
      createSession("foolery-default-overflow", "/tmp/repo", "custom prompt"),
    ).rejects.toThrow("Max concurrent sessions (5) reached");
  });
});
