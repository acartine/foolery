import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStartScopeRefinementWorker = vi.fn();

vi.mock("@/lib/scope-refinement-worker", () => ({
  startScopeRefinementWorker: () => mockStartScopeRefinementWorker(),
}));

import {
  enqueueScopeRefinementJob,
  clearScopeRefinementQueue,
} from "@/lib/scope-refinement-queue";
import {
  recordScopeRefinementCompletion,
  clearScopeRefinementCompletions,
} from "@/lib/scope-refinement-events";
import { GET } from "@/app/api/scope-refinement/status/route";

describe("GET /api/scope-refinement/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScopeRefinementQueue();
    clearScopeRefinementCompletions();
  });

  it("returns response envelope with queueSize and completions", async () => {
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      data: {
        queueSize: 0,
        completions: [],
        failures: [],
      },
    });
  });

  it("starts the scope refinement worker on each request", async () => {
    await GET();

    expect(mockStartScopeRefinementWorker).toHaveBeenCalledTimes(1);
  });

  it("reflects enqueued jobs in queueSize", async () => {
    enqueueScopeRefinementJob({ beatId: "b1" });
    enqueueScopeRefinementJob({ beatId: "b2" });

    const response = await GET();
    const json = await response.json();

    expect(json.data.queueSize).toBe(2);
  });

  it("includes recorded completions with beatId for detail query invalidation", async () => {
    recordScopeRefinementCompletion({
      beatId: "foolery-xyz",
      beatTitle: "Some beat",
      repoPath: "/repo",
    });

    const response = await GET();
    const json = await response.json();

    expect(json.data.completions).toHaveLength(1);
    expect(json.data.completions[0]).toMatchObject({
      beatId: "foolery-xyz",
      beatTitle: "Some beat",
      repoPath: "/repo",
    });
    expect(json.data.completions[0].id).toBeTruthy();
    expect(json.data.completions[0].timestamp).toBeGreaterThan(0);
  });
});
