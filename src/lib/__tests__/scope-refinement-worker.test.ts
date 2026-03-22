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
  getScopeRefinementSettings: () => mockGetScopeRefinementSettings(),
  getScopeRefinementAgent: () => mockGetScopeRefinementAgent(),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  clearScopeRefinementCompletions,
  listScopeRefinementCompletions,
} from "@/lib/scope-refinement-events";
import { clearScopeRefinementQueue, getScopeRefinementQueueSize } from "@/lib/scope-refinement-queue";
import {
  processScopeRefinementJob,
  resetScopeRefinementWorkerState,
} from "@/lib/scope-refinement-worker";

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  emitOutput: () => void;
}

function createMockChild(output: string, exitCode = 0): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.emitOutput = () => {
    child.stdout.emit("data", Buffer.from(output));
    child.emit("close", exitCode);
  };
  return child;
}

describe("processScopeRefinementJob", () => {
  beforeEach(() => {
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
      enabled: true,
      prompt: "Title={{title}}\nDescription={{description}}\nAcceptance={{acceptance}}",
    });
    mockGetScopeRefinementAgent.mockResolvedValue({
      kind: "cli",
      command: "claude",
    });
  });

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

  it("skips work when scope refinement is disabled", async () => {
    mockGetScopeRefinementSettings.mockResolvedValue({
      enabled: false,
      prompt: "ignored",
    });

    await processScopeRefinementJob({
      id: "job-1",
      beatId: "foolery-1",
      createdAt: Date.now(),
    });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
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
    mockUpdate.mockResolvedValue({ ok: false, error: "backend error" });

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
    expect(listScopeRefinementCompletions()).toHaveLength(0);
  });
});
