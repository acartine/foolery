import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueScopeRefinementJob,
  clearScopeRefinementQueue,
  getScopeRefinementQueueSize,
} from "@/lib/scope-refinement-queue";
import {
  recordScopeRefinementCompletion,
  listScopeRefinementCompletions,
  clearScopeRefinementCompletions,
} from "@/lib/scope-refinement-events";

describe("scope refinement status endpoint contract", () => {
  beforeEach(() => {
    clearScopeRefinementQueue();
    clearScopeRefinementCompletions();
  });

  it("returns queue size reflecting enqueued jobs", () => {
    expect(getScopeRefinementQueueSize()).toBe(0);
    enqueueScopeRefinementJob({ beatId: "b1" });
    enqueueScopeRefinementJob({ beatId: "b2" });
    expect(getScopeRefinementQueueSize()).toBe(2);
  });

  it("returns completions with beatId and beatTitle", () => {
    recordScopeRefinementCompletion({
      beatId: "b1",
      beatTitle: "Test beat",
      repoPath: "/repo",
    });
    const completions = listScopeRefinementCompletions();
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      beatId: "b1",
      beatTitle: "Test beat",
      repoPath: "/repo",
    });
    expect(completions[0]!.id).toBeTruthy();
    expect(completions[0]!.timestamp).toBeGreaterThan(0);
  });

  it("completion includes beatId for detail query invalidation", () => {
    recordScopeRefinementCompletion({
      beatId: "foolery-xyz",
      beatTitle: "Some beat",
    });
    const completions = listScopeRefinementCompletions();
    // The notification hook uses completion.beatId to invalidate
    // ["beat", completion.beatId] queries
    expect(completions[0]!.beatId).toBe("foolery-xyz");
  });
});
