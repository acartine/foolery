import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendPort } from "@/lib/backend-port";
import type { Beat } from "@/lib/types";
import type { StaleBeatGroomingResult } from "@/lib/stale-beat-grooming-types";

const mockResolveAgent = vi.fn();
const mockRunPrompt = vi.fn();

const backend = createBackend();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => backend,
}));

vi.mock("@/lib/stale-beat-grooming-agent", () => ({
  resolveStaleBeatGroomingAgent: (
    ...args: unknown[]
  ) => mockResolveAgent(...args),
}));

vi.mock("@/lib/stale-beat-grooming-prompt", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/stale-beat-grooming-prompt")
  >();
  return {
    ...actual,
    runStaleBeatGroomingPrompt: (
      ...args: unknown[]
    ) => mockRunPrompt(...args),
  };
});

import {
  processStaleBeatGroomingJob,
} from "@/lib/stale-beat-grooming-job-runner";
import {
  clearStaleBeatGroomingReviews,
  recordStaleBeatGroomingQueued,
} from "@/lib/stale-beat-grooming-store";
import { GET } from "@/app/api/beats/stale-grooming/status/route";

beforeEach(() => {
  vi.clearAllMocks();
  clearStaleBeatGroomingReviews();
  backend.reset();
  mockResolveAgent.mockResolvedValue({
    kind: "cli",
    command: "codex",
    agentId: "codex",
  });
});

describe("stale beat grooming successful outcomes", () => {
  it.each([
    ["still_do", stillDoResult()],
    ["reshape", reshapeResult()],
    ["drop", dropResult()],
  ] as const)(
    "appends a handoff capsule and updates lastUpdated for %s",
    async (_decision, result) => {
      mockRunPrompt.mockResolvedValue(groomingJson(result));
      const before = backend.beat.updated;

      await queueAndProcess("job-ts");

      expect(backend.updateCalls).toHaveLength(1);
      expect(backend.beat.updated).not.toBe(before);
      expect(lastCapsule()).toContain(
        "Beat was groomed because it was stale.",
      );
      expect(lastCapsule()).toContain(`Decision: ${result.decision}`);
      expect(lastCapsule()).toContain(`Rationale: ${result.rationale}`);
      expect(lastCapsule()).toContain("Agent: codex");
      expect(lastCapsule()).toContain("Job: job-ts");
    },
  );

  it("keeps still_do as a capsule-only acknowledgement", async () => {
    mockRunPrompt.mockResolvedValue(groomingJson(stillDoResult()));

    await queueAndProcess("job-still");

    expect(backend.updateCalls[0]?.input).toMatchObject({
      addHandoffCapsule: expect.any(String),
    });
    expect(backend.updateCalls[0]?.input).not.toHaveProperty("title");
    expect(backend.updateCalls[0]?.input).not.toHaveProperty(
      "description",
    );
    expect(backend.updateCalls[0]?.input).not.toHaveProperty(
      "acceptance",
    );
    expect(backend.markTerminalCalls).toHaveLength(0);
    expect(backend.beat.title).toBe("Old title");
    expect(backend.beat.state).toBe("ready_for_implementation");
  });

  it("applies reshape fields through backend.update", async () => {
    mockRunPrompt.mockResolvedValue(groomingJson(reshapeResult()));

    await queueAndProcess("job-reshape");

    expect(backend.updateCalls[0]?.input).toMatchObject({
      title: "New title",
      description: "New description",
      acceptance: "New acceptance",
      addHandoffCapsule: expect.stringContaining(
        "Applied reshape fields: title, description, acceptance",
      ),
    });
    expect(backend.beat.title).toBe("New title");
    expect(backend.beat.description).toBe("New description");
    expect(backend.beat.acceptance).toBe("New acceptance");
    expect(backend.markTerminalCalls).toHaveLength(0);
  });

  it("marks drop results abandoned through backend.markTerminal", async () => {
    mockRunPrompt.mockResolvedValue(groomingJson(dropResult()));

    await queueAndProcess("job-drop");

    expect(backend.updateCalls[0]?.input).toMatchObject({
      addHandoffCapsule: expect.stringContaining(
        "Action: marked abandoned.",
      ),
    });
    expect(backend.markTerminalCalls).toEqual([
      {
        id: "foolery-stale-1",
        targetState: "abandoned",
        reason: "Stale grooming decision: drop",
        repoPath: "/repo",
      },
    ]);
    expect(backend.beat.state).toBe("abandoned");
  });
});

describe("stale beat grooming result observability", () => {
  it("leaves status results visible after applying the outcome", async () => {
    const result = reshapeResult();
    mockRunPrompt.mockResolvedValue(groomingJson(result));

    await queueAndProcess("job-status");
    const response = await GET();
    const payload = await response.json();

    expect(payload.data.reviews).toEqual([
      expect.objectContaining({
        beatId: "foolery-stale-1",
        status: "completed",
        result,
      }),
    ]);
  });

  it("does not mutate beats or append success capsules on parse failure", async () => {
    mockRunPrompt.mockResolvedValue("not json");

    const outcome = await queueAndProcess("job-failed");

    expect(outcome.ok).toBe(false);
    expect(backend.updateCalls).toHaveLength(0);
    expect(backend.markTerminalCalls).toHaveLength(0);
    expect(backend.handoffCapsules).toHaveLength(0);
  });
});

function queueAndProcess(jobId: string) {
  recordStaleBeatGroomingQueued({
    jobId,
    beatId: "foolery-stale-1",
    repoPath: "/repo",
    agentId: "codex",
  });
  return processStaleBeatGroomingJob({
    id: jobId,
    beatId: "foolery-stale-1",
    repoPath: "/repo",
    agentId: "codex",
    createdAt: Date.now(),
  });
}

function lastCapsule(): string {
  return backend.handoffCapsules.at(-1)?.content ?? "";
}

function stillDoResult(): StaleBeatGroomingResult {
  return {
    decision: "still_do",
    rationale: "Still valuable.",
  };
}

function reshapeResult(): StaleBeatGroomingResult {
  return {
    decision: "reshape",
    rationale: "Needs a tighter scope.",
    suggestedTitle: "New title",
    suggestedDescription: "New description",
    suggestedAcceptance: "New acceptance",
  };
}

function dropResult(): StaleBeatGroomingResult {
  return {
    decision: "drop",
    rationale: "No longer useful.",
  };
}

function groomingJson(result: StaleBeatGroomingResult): string {
  return [
    "<stale_beat_grooming_json>",
    JSON.stringify(result),
    "</stale_beat_grooming_json>",
  ].join("\n");
}

interface UpdateCall {
  id: string;
  input: Record<string, unknown>;
  repoPath?: string;
}

interface MarkTerminalCall {
  id: string;
  targetState: string;
  reason?: string;
  repoPath?: string;
}

type TestBackend = BackendPort & {
  beat: Beat;
  handoffCapsules: Array<{ content: string }>;
  updateCalls: UpdateCall[];
  markTerminalCalls: MarkTerminalCall[];
  reset(): void;
};

function createBackend(): TestBackend {
  const testBackend: TestBackend = {
    beat: makeBeat(),
    handoffCapsules: [] as Array<{ content: string }>,
    updateCalls: [] as UpdateCall[],
    markTerminalCalls: [] as MarkTerminalCall[],
    reset() {
      this.beat = makeBeat();
      this.handoffCapsules = [];
      this.updateCalls = [];
      this.markTerminalCalls = [];
    },
    async get(id: string) {
      if (id !== this.beat.id) return { ok: false, error: "missing" };
      return { ok: true, data: this.beat };
    },
    async update(
      id: string,
      input: Record<string, unknown>,
      repoPath?: string,
    ) {
      this.updateCalls.push({ id, input, repoPath });
      if (typeof input.title === "string") this.beat.title = input.title;
      if (typeof input.description === "string") {
        this.beat.description = input.description;
      }
      if (typeof input.acceptance === "string") {
        this.beat.acceptance = input.acceptance;
      }
      if (typeof input.addHandoffCapsule === "string") {
        this.handoffCapsules.push({ content: input.addHandoffCapsule });
      }
      this.beat.updated = "2026-05-11T10:00:00.000Z";
      return { ok: true };
    },
    async markTerminal(
      id: string,
      targetState: string,
      reason?: string,
      repoPath?: string,
    ) {
      this.markTerminalCalls.push({
        id,
        targetState,
        reason,
        repoPath,
      });
      this.beat.state = targetState;
      this.beat.updated = "2026-05-11T10:00:01.000Z";
      return { ok: true };
    },
  } as TestBackend;
  return testBackend;
}

function makeBeat(): Beat {
  return {
    id: "foolery-stale-1",
    title: "Old title",
    description: "Old description",
    acceptance: "Old acceptance",
    type: "work",
    state: "ready_for_implementation",
    priority: 2,
    labels: [],
    created: "2026-04-01T00:00:00.000Z",
    updated: "2026-04-01T00:00:00.000Z",
  };
}
