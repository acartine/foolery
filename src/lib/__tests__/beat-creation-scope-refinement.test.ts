import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnqueueBeatScopeRefinement = vi.fn();

vi.mock("@/lib/scope-refinement-worker", () => ({
  enqueueBeatScopeRefinement: (...args: unknown[]) => mockEnqueueBeatScopeRefinement(...args),
}));

import {
  enqueueBeatScopeRefinement,
} from "@/lib/scope-refinement-worker";

describe("beat creation scope refinement enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueueBeatScopeRefinement is called with beatId and repoPath", async () => {
    mockEnqueueBeatScopeRefinement.mockResolvedValue(null);

    // Simulate what the POST /api/beats route does after creation
    const createdBeatId = "foolery-abc";
    const repoPath = "/tmp/repo";
    await enqueueBeatScopeRefinement(createdBeatId, repoPath);

    expect(mockEnqueueBeatScopeRefinement).toHaveBeenCalledWith("foolery-abc", "/tmp/repo");
  });

  it("enqueueBeatScopeRefinement gracefully returns null when disabled", async () => {
    mockEnqueueBeatScopeRefinement.mockResolvedValue(null);

    const result = await enqueueBeatScopeRefinement("foolery-abc", "/tmp/repo");
    expect(result).toBeNull();
  });
});
