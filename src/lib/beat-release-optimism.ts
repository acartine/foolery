import type { Beat } from "@/lib/types";

const ACTIVE_TO_READY_STATE: Record<string, string> = {
  planning: "ready_for_planning",
  plan_review: "ready_for_plan_review",
  implementation: "ready_for_implementation",
  implementation_review: "ready_for_implementation_review",
  shipment: "ready_for_shipment",
  shipment_review: "ready_for_shipment_review",
};

export interface PendingBeatRelease {
  key: string;
  beatId: string;
  repoPath?: string;
  originalState: string;
  targetState: string;
  sentAt: string;
}

export function createPendingBeatRelease(
  beat: Beat,
  repoPath?: string,
  sentAt: string = new Date().toISOString(),
): PendingBeatRelease | null {
  const originalState = normalizeState(beat.state);
  const targetState = ACTIVE_TO_READY_STATE[originalState];
  if (!targetState) return null;
  const normalizedRepoPath = normalizeRepoPath(
    repoPath ?? repoPathForBeat(beat),
  );
  return {
    key: pendingReleaseKey(beat.id, normalizedRepoPath),
    beatId: beat.id,
    repoPath: normalizedRepoPath,
    originalState,
    targetState,
    sentAt,
  };
}

export function applyPendingBeatReleases(
  beats: readonly Beat[],
  pendingReleases: ReadonlyMap<string, PendingBeatRelease>,
): Beat[] {
  if (pendingReleases.size === 0) return [...beats];
  return beats.map((beat) => {
    const pending = pendingReleaseForBeat(beat, pendingReleases);
    if (!pending) return beat;
    return {
      ...beat,
      state: pending.targetState,
      updated: pending.sentAt,
    };
  });
}

export function settledPendingBeatReleaseKeys(
  beats: readonly Beat[],
  pendingReleases: ReadonlyMap<string, PendingBeatRelease>,
): string[] {
  if (pendingReleases.size === 0) return [];
  const settledKeys: string[] = [];

  for (const pending of pendingReleases.values()) {
    const beat = beats.find((entry) =>
      samePendingReleaseTarget(entry, pending)
    );
    if (beat && normalizeState(beat.state) !== pending.originalState) {
      settledKeys.push(pending.key);
    }
  }

  return settledKeys;
}

export function pendingReleaseKey(
  beatId: string,
  repoPath?: string,
): string {
  return `${normalizeRepoPath(repoPath) ?? ""}:${beatId}`;
}

function pendingReleaseForBeat(
  beat: Beat,
  pendingReleases: ReadonlyMap<string, PendingBeatRelease>,
): PendingBeatRelease | undefined {
  const repoPath = repoPathForBeat(beat);
  return pendingReleases.get(pendingReleaseKey(beat.id, repoPath))
    ?? pendingReleases.get(pendingReleaseKey(beat.id))
    ?? [...pendingReleases.values()].find((pending) =>
      samePendingReleaseTarget(beat, pending)
    );
}

function samePendingReleaseTarget(
  beat: Beat,
  pending: PendingBeatRelease,
): boolean {
  if (beat.id !== pending.beatId) return false;
  const repoPath = repoPathForBeat(beat);
  if (!pending.repoPath || !repoPath) return true;
  return repoPath === pending.repoPath;
}

function repoPathForBeat(beat: Beat): string | undefined {
  const raw = (beat as Beat & { _repoPath?: unknown })._repoPath;
  return normalizeRepoPath(raw);
}

function normalizeRepoPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeState(state: string): string {
  return state.trim().toLowerCase();
}
