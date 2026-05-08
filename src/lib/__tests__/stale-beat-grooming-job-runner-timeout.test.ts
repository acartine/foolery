import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetBeat = vi.fn();
const mockResolveAgent = vi.fn();
const mockSpawn = vi.fn();
const mockRecordRunning = vi.fn();
const mockRecordFailed = vi.fn();
const mockRecordCompleted = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    get: (...args: unknown[]) => mockGetBeat(...args),
  }),
}));

vi.mock("@/lib/stale-beat-grooming-agent", () => ({
  resolveStaleBeatGroomingAgent: (
    ...args: unknown[]
  ) => mockResolveAgent(...args),
}));

vi.mock("@/lib/stale-beat-grooming-store", () => ({
  recordStaleBeatGroomingRunning: (
    ...args: unknown[]
  ) => mockRecordRunning(...args),
  recordStaleBeatGroomingFailed: (
    ...args: unknown[]
  ) => mockRecordFailed(...args),
  recordStaleBeatGroomingCompleted: (
    ...args: unknown[]
  ) => mockRecordCompleted(...args),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  processStaleBeatGroomingJob,
} from "@/lib/stale-beat-grooming-job-runner";
import {
  STALE_GROOMING_PROMPT_TIMEOUT_MS,
} from "@/lib/stale-beat-grooming-prompt";

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createHangingChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function setupDefaults() {
  vi.clearAllMocks();
  mockGetBeat.mockResolvedValue({
    ok: true,
    data: {
      id: "foolery-stale-1",
      title: "Old beat",
      description: "Old description",
      acceptance: "Old acceptance",
      state: "ready_for_planning",
      created: new Date(0).toISOString(),
      updated: new Date(0).toISOString(),
    },
  });
  mockResolveAgent.mockResolvedValue({
    kind: "cli",
    command: "claude",
    agentId: "claude",
  });
}

describe("processStaleBeatGroomingJob: timeout", () => {
  beforeEach(setupDefaults);

  it(
    "kills hung agent with stale-grooming-specific error message",
    async () => {
      vi.useFakeTimers();
      const child = createHangingChild();
      mockSpawn.mockReturnValue(child);

      const promise = processStaleBeatGroomingJob({
        id: "job-1",
        beatId: "foolery-stale-1",
        agentId: "claude",
        createdAt: Date.now(),
      });

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalledTimes(1);
      });

      vi.advanceTimersByTime(
        STALE_GROOMING_PROMPT_TIMEOUT_MS + 1,
      );

      const outcome = await promise;
      vi.useRealTimers();

      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toMatch(
        /stale grooming agent timed out after 600s/,
      );
      expect(outcome.error).not.toMatch(/scope refinement/i);

      expect(mockRecordFailed).toHaveBeenCalledTimes(1);
      const [, recordedError] =
        mockRecordFailed.mock.calls[0] ?? [];
      expect(recordedError).toMatch(
        /stale grooming agent timed out after 600s/,
      );
      expect(recordedError).not.toMatch(/scope refinement/i);
      expect(mockRecordCompleted).not.toHaveBeenCalled();
    },
  );

  it(
    "tags timeout log lines with [stale-grooming] subsystem",
    async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, "warn")
        .mockImplementation(() => {});
      const log = vi.spyOn(console, "log")
        .mockImplementation(() => {});
      const child = createHangingChild();
      mockSpawn.mockReturnValue(child);

      const promise = processStaleBeatGroomingJob({
        id: "job-1",
        beatId: "foolery-stale-1",
        agentId: "claude",
        createdAt: Date.now(),
      });

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalledTimes(1);
      });

      vi.advanceTimersByTime(
        STALE_GROOMING_PROMPT_TIMEOUT_MS + 1,
      );
      await promise;
      vi.useRealTimers();

      const allLogs = [
        ...warn.mock.calls.map((c) => String(c[0])),
        ...log.mock.calls.map((c) => String(c[0])),
      ].join("\n");
      expect(allLogs).toMatch(/\[stale-grooming\]/);
      expect(allLogs).not.toMatch(/\[scope-refinement\]/);

      warn.mockRestore();
      log.mockRestore();
    },
  );
});
