import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockGetScopeRefinementSettings = vi.fn();
const mockGetScopeRefinementAgent = vi.fn();
const mockSpawn = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    get: (...args: unknown[]) => mockGet(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  }),
}));

vi.mock("@/lib/settings", () => ({
  getScopeRefinementSettings: () =>
    mockGetScopeRefinementSettings(),
  getScopeRefinementAgent: (
    ...args: unknown[]
  ) => mockGetScopeRefinementAgent(...args),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  clearScopeRefinementCompletions,
  listScopeRefinementCompletions,
} from "@/lib/scope-refinement-events";
import {
  clearScopeRefinementQueue,
  dequeueScopeRefinementJob,
  getScopeRefinementQueueSize,
} from "@/lib/scope-refinement-queue";
import {
  getScopeRefinementWorkerHealth,
  processScopeRefinementJob,
  resetScopeRefinementWorkerState,
} from "@/lib/scope-refinement-worker";

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  emitOutput: () => void;
}

function createMockChild(
  output: string,
  exitCode = 0,
): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.emitOutput = () => {
    child.stdout.emit("data", Buffer.from(output));
    child.emit("close", exitCode);
  };
  return child;
}

function setupScopeRefinementDefaults() {
  vi.clearAllMocks();
  clearScopeRefinementCompletions();
  clearScopeRefinementQueue();
  resetScopeRefinementWorkerState();

  mockGet.mockResolvedValue({
    ok: true,
    data: {
      id: "foolery-1",
      title: "Loose title",
      description: "Loose description",
      acceptance: "",
    },
  });
  mockUpdate.mockResolvedValue({ ok: true });
  mockGetScopeRefinementSettings.mockResolvedValue({
    prompt: "Title={{title}}\nDescription={{description}}\nAcceptance={{acceptance}}",
  });
  mockGetScopeRefinementAgent.mockResolvedValue({
    kind: "cli",
    command: "claude",
  });
}

describe("processScopeRefinementJob: success", () => {
  beforeEach(setupScopeRefinementDefaults);

    it("updates the beat and records a completion event", async () => {
    const payload = '<scope_refinement_json>{"title":"Sharper title","description":"Clear description","acceptance":"Clear acceptance"}</scope_refinement_json>';
    const child = createMockChild(
      `${JSON.stringify({ type: "result", result: payload })}\n`,
    );
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      repoPath: "/tmp/repo",
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.emitOutput();
    await promise;

    expect(mockUpdate).toHaveBeenCalledWith(
      "foolery-1",
      {
        title: "Sharper title",
        description: "Clear description",
        acceptance: "Clear acceptance",
      },
      "/tmp/repo",
    );
    expect(listScopeRefinementCompletions()).toEqual([
      expect.objectContaining({
        beatId: "foolery-1",
        beatTitle: "Sharper title",
        repoPath: "/tmp/repo",
      }),
    ]);
  });

  it("skips work when no agent is configured", async () => {
    mockGetScopeRefinementAgent.mockResolvedValue(null);

    await processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

});

describe("processScopeRefinementJob: failure", () => {
  beforeEach(setupScopeRefinementDefaults);

    it("re-enqueues job on agent failure", async () => {
    const child = createMockChild("", 1);
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.stderr.emit("data", Buffer.from("agent crashed"));
    child.emit("close", 1);
    await promise;

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getScopeRefinementQueueSize()).toBe(1);
  });

  it("rejects result events with is_error=true instead of treating as success", async () => {
    // Simulates a normalized event from codex/opencode with is_error flag
    const errorResult = JSON.stringify({
      type: "result",
      result: "Turn failed",
      is_error: true,
    });
    const child = createMockChild(`${errorResult}\n`);
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.emitOutput();
    await promise;

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getScopeRefinementQueueSize()).toBe(1);
  });

  it("re-enqueues job when backend.get fails", async () => {
    mockGet.mockResolvedValue({
      ok: false,
      error: { message: "not found", code: "NOT_FOUND", retryable: false },
    });

    await processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getScopeRefinementQueueSize()).toBe(1);
  });

  it("re-enqueues job on unparseable output", async () => {
    const child = createMockChild(
      `${JSON.stringify({ type: "result", result: "not json at all" })}\n`,
    );
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.emitOutput();
    await promise;

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getScopeRefinementQueueSize()).toBe(1);
  });

  it("re-enqueues job on backend update failure", async () => {
    const payload = '<scope_refinement_json>{"title":"Better title","description":"Better desc","acceptance":"AC"}</scope_refinement_json>';
    const child = createMockChild(
      `${JSON.stringify({ type: "result", result: payload })}\n`,
    );
    mockSpawn.mockReturnValue(child);
    mockUpdate.mockResolvedValue({
      ok: false, error: "backend error",
    });

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.emitOutput();
    await promise;

    expect(getScopeRefinementQueueSize()).toBe(1);
    expect(
      listScopeRefinementCompletions(),
    ).toHaveLength(0);
  });
});

describe("processScopeRefinementJob: timeout", () => {
  beforeEach(setupScopeRefinementDefaults);

  it("kills child and re-enqueues after 600s", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as MockChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.emitOutput = () => {};
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(600_001);

    await promise;

    vi.useRealTimers();

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getScopeRefinementQueueSize()).toBe(1);
  });

  it("does not trigger at old 180s timeout", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as MockChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.emitOutput = () => {};
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(180_001);

    expect(child.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(420_000);
    await promise;
    vi.useRealTimers();

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});

describe("processScopeRefinementJob: agent exclusion on retry", () => {
  beforeEach(setupScopeRefinementDefaults);

  it("carries failed agentId in excludeAgentIds on re-enqueue", async () => {
    mockGetScopeRefinementAgent.mockResolvedValue({
      kind: "cli",
      command: "claude",
      agentId: "agent-a",
    });
    const child = createMockChild("", 1);
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.stderr.emit(
      "data", Buffer.from("agent crashed"),
    );
    child.emit("close", 1);
    await promise;

    expect(getScopeRefinementQueueSize()).toBe(1);
    const requeued = dequeueScopeRefinementJob();
    expect(requeued?.excludeAgentIds).toEqual(
      ["agent-a"],
    );
  });

  it("accumulates excluded agents across retries", async () => {
    mockGetScopeRefinementAgent.mockResolvedValue({
      kind: "cli",
      command: "claude",
      agentId: "agent-b",
    });
    const child = createMockChild("", 1);
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      excludeAgentIds: ["agent-a"],
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.stderr.emit(
      "data", Buffer.from("agent crashed"),
    );
    child.emit("close", 1);
    await promise;

    const requeued = dequeueScopeRefinementJob();
    expect(requeued?.excludeAgentIds).toEqual(
      ["agent-a", "agent-b"],
    );
  });
});

describe("processScopeRefinementJob: agent fallback resolution", () => {
  beforeEach(setupScopeRefinementDefaults);

  it("passes exclusions to getScopeRefinementAgent", async () => {
    mockGetScopeRefinementAgent.mockResolvedValue({
      kind: "cli",
      command: "claude",
      agentId: "agent-c",
    });
    const payload =
      '<scope_refinement_json>'
      + '{"title":"T","description":"D"}'
      + '</scope_refinement_json>';
    const child = createMockChild(
      `${JSON.stringify({ type: "result", result: payload })}\n`,
    );
    mockSpawn.mockReturnValue(child);

    const promise = processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      excludeAgentIds: ["agent-a"],
      createdAt: Date.now(),
    });
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    child.emitOutput();
    await promise;

    expect(
      mockGetScopeRefinementAgent,
    ).toHaveBeenCalledWith(new Set(["agent-a"]));
  });

  it("fails gracefully when all agents exhausted", async () => {
    mockGetScopeRefinementAgent.mockResolvedValue(
      null,
    );

    await processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      excludeAgentIds: ["agent-a", "agent-b"],
      createdAt: Date.now(),
    });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getScopeRefinementQueueSize()).toBe(0);

    const health = getScopeRefinementWorkerHealth();
    expect(health.totalFailed).toBe(1);
    expect(health.recentFailures).toHaveLength(1);
    expect(
      health.recentFailures[0]!.reason,
    ).toContain("no alternative refinement agent");
  });
});
