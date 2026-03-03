import { describe, expect, it } from "vitest";
import {
  createCompletionAnimationTracker,
  pruneCompletionAnimationTracker,
  shouldAnimateCompletion,
} from "@/lib/terminal-tab-completion";

describe("terminal-tab completion animation tracking", () => {
  it("does not animate for sessions first seen as completed", () => {
    const tracker = createCompletionAnimationTracker();

    expect(shouldAnimateCompletion(tracker, "sess-1", "completed")).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-1", "completed")).toBe(false);
  });

  it("animates once when a known running session transitions to completed", () => {
    const tracker = createCompletionAnimationTracker();

    expect(shouldAnimateCompletion(tracker, "sess-2", "running")).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-2", "completed")).toBe(true);
    expect(shouldAnimateCompletion(tracker, "sess-2", "completed")).toBe(false);
  });

  it("animates again after leaving completed and returning to completed", () => {
    const tracker = createCompletionAnimationTracker();

    expect(shouldAnimateCompletion(tracker, "sess-3", "running")).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-3", "completed")).toBe(true);
    expect(shouldAnimateCompletion(tracker, "sess-3", "running")).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-3", "completed")).toBe(true);
  });

  it("suppresses animation when disabled but keeps status tracking", () => {
    const tracker = createCompletionAnimationTracker();

    expect(
      shouldAnimateCompletion(tracker, "sess-3", "running", { allowAnimation: false }),
    ).toBe(false);
    expect(
      shouldAnimateCompletion(tracker, "sess-3", "completed", { allowAnimation: false }),
    ).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-3", "completed")).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-3", "running")).toBe(false);
    expect(shouldAnimateCompletion(tracker, "sess-3", "completed")).toBe(true);
  });

  it("prunes removed sessions from tracker state", () => {
    const tracker = createCompletionAnimationTracker();

    shouldAnimateCompletion(tracker, "sess-4", "running");
    shouldAnimateCompletion(tracker, "sess-5", "completed");
    pruneCompletionAnimationTracker(tracker, new Set(["sess-4"]));

    expect(tracker.seenSessionIds.has("sess-4")).toBe(true);
    expect(tracker.seenSessionIds.has("sess-5")).toBe(false);
    expect(tracker.previousStatusBySession.has("sess-4")).toBe(true);
    expect(tracker.previousStatusBySession.has("sess-5")).toBe(false);
  });
});
