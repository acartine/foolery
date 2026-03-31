import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearScopeRefinementQueue,
  dequeueScopeRefinementJob,
  enqueueScopeRefinementJob,
  getScopeRefinementQueueSize,
  onEnqueue,
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

  it("calls onEnqueue listeners when a job is enqueued", () => {
    const listener = vi.fn();
    onEnqueue(listener);
    enqueueScopeRefinementJob({ beatId: "b1" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes the listener", () => {
    const listener = vi.fn();
    const unsub = onEnqueue(listener);
    unsub();
    enqueueScopeRefinementJob({ beatId: "b1" });
    expect(listener).not.toHaveBeenCalled();
  });
});
