import { describe, expect, it } from "vitest";
import { filterNewCompletions } from "@/hooks/use-scope-refinement-notifications";
import type { ScopeRefinementCompletion } from "@/lib/types";

function makeCompletion(overrides: Partial<ScopeRefinementCompletion> = {}): ScopeRefinementCompletion {
  return {
    id: "comp-1",
    beatId: "foolery-abc",
    beatTitle: "Some beat",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("filterNewCompletions", () => {
  it("emits notification and beatId for new completions after mount time", () => {
    const seenIds = new Set<string>();
    const mountedAt = 1000;
    const completions = [
      makeCompletion({ id: "c1", beatId: "b1", beatTitle: "Beat One", timestamp: 2000 }),
    ];

    const result = filterNewCompletions(completions, seenIds, mountedAt);

    expect(result.notifications).toEqual([
      {
        message: 'Scope refinement complete for "Beat One"',
        beatId: "b1",
        repoPath: undefined,
      },
    ]);
    expect(result.beatIds).toEqual(["b1"]);
  });

  it("skips completions already in seenIds (deduplication)", () => {
    const seenIds = new Set(["c1"]);
    const mountedAt = 1000;
    const completions = [
      makeCompletion({ id: "c1", beatId: "b1", timestamp: 2000 }),
    ];

    const result = filterNewCompletions(completions, seenIds, mountedAt);

    expect(result.notifications).toHaveLength(0);
    expect(result.beatIds).toHaveLength(0);
  });

  it("skips completions with timestamp before mount time", () => {
    const seenIds = new Set<string>();
    const mountedAt = 5000;
    const completions = [
      makeCompletion({ id: "c1", beatId: "b1", timestamp: 3000 }),
    ];

    const result = filterNewCompletions(completions, seenIds, mountedAt);

    expect(result.notifications).toHaveLength(0);
    // but still marks as seen to avoid re-processing
    expect(seenIds.has("c1")).toBe(true);
  });

  it("includes repoPath in notification when present", () => {
    const seenIds = new Set<string>();
    const mountedAt = 1000;
    const completions = [
      makeCompletion({ id: "c1", beatId: "b1", beatTitle: "Beat", timestamp: 2000, repoPath: "/repo" }),
    ];

    const result = filterNewCompletions(completions, seenIds, mountedAt);

    expect(result.notifications[0]!.repoPath).toBe("/repo");
  });

  it("provides beatIds for query invalidation of beat detail views", () => {
    const seenIds = new Set<string>();
    const mountedAt = 1000;
    const completions = [
      makeCompletion({ id: "c1", beatId: "foolery-x", timestamp: 2000 }),
      makeCompletion({ id: "c2", beatId: "foolery-y", timestamp: 2000 }),
    ];

    const result = filterNewCompletions(completions, seenIds, mountedAt);

    expect(result.beatIds).toEqual(["foolery-x", "foolery-y"]);
  });
});
