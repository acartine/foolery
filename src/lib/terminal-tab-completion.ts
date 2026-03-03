import type { TerminalSessionStatus } from "@/lib/types";

export interface CompletionAnimationTracker {
  seenSessionIds: Set<string>;
  previousStatusBySession: Map<string, TerminalSessionStatus>;
}

interface CompletionAnimationOptions {
  allowAnimation?: boolean;
}

export function createCompletionAnimationTracker(): CompletionAnimationTracker {
  return {
    seenSessionIds: new Set<string>(),
    previousStatusBySession: new Map<string, TerminalSessionStatus>(),
  };
}

export function shouldAnimateCompletion(
  tracker: CompletionAnimationTracker,
  sessionId: string,
  status: TerminalSessionStatus,
  options?: CompletionAnimationOptions,
): boolean {
  const allowAnimation = options?.allowAnimation ?? true;
  const hasSeenSession = tracker.seenSessionIds.has(sessionId);
  const previousStatus = tracker.previousStatusBySession.get(sessionId);
  const transitionedToCompleted =
    allowAnimation && status === "completed" && hasSeenSession && previousStatus !== "completed";

  tracker.seenSessionIds.add(sessionId);
  tracker.previousStatusBySession.set(sessionId, status);
  return transitionedToCompleted;
}

export function pruneCompletionAnimationTracker(
  tracker: CompletionAnimationTracker,
  activeSessionIds: Set<string>,
): void {
  for (const sessionId of tracker.seenSessionIds) {
    if (!activeSessionIds.has(sessionId)) {
      tracker.seenSessionIds.delete(sessionId);
    }
  }
  for (const sessionId of tracker.previousStatusBySession.keys()) {
    if (!activeSessionIds.has(sessionId)) {
      tracker.previousStatusBySession.delete(sessionId);
    }
  }
}
