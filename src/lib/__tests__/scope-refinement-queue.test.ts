import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScopeRefinementQueue,
  dequeueScopeRefinementJob,
  enqueueScopeRefinementJob,
  getScopeRefinementQueueSize,
  peekScopeRefinementJob,
} from "@/lib/scope-refinement-queue";

describe("scope refinement queue", () => {
  beforeEach(() => {
    clearScopeRefinementQueue();
  });

  it("enqueues and dequeues jobs in FIFO order", () => {
    const first = enqueueScopeRefinementJob({ beatId: "foolery-a", repoPath: "/tmp/repo" });
    const second = enqueueScopeRefinementJob({ beatId: "foolery-b" });

    expect(getScopeRefinementQueueSize()).toBe(2);
    expect(peekScopeRefinementJob()?.id).toBe(first.id);
    expect(dequeueScopeRefinementJob()?.id).toBe(first.id);
    expect(dequeueScopeRefinementJob()?.id).toBe(second.id);
    expect(getScopeRefinementQueueSize()).toBe(0);
  });

  it("clears all jobs", () => {
    enqueueScopeRefinementJob({ beatId: "foolery-a" });
    clearScopeRefinementQueue();
    expect(getScopeRefinementQueueSize()).toBe(0);
    expect(dequeueScopeRefinementJob()).toBeUndefined();
  });
});
