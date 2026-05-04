import type { Beat } from "@/lib/types";
import { compareBeatsByPriorityThenUpdated } from "@/lib/beat-sort";
import { compareWorkflowStatePriority } from "@/lib/workflows";

export interface BeatStateGroup {
  state: string;
  beats: Beat[];
}

export function normalizeOverviewState(
  state: string | null | undefined,
): string {
  const normalized = state?.trim().toLowerCase();
  return normalized && normalized.length > 0
    ? normalized
    : "unknown";
}

export function groupBeatsByState(
  beats: readonly Beat[],
): BeatStateGroup[] {
  const byState = new Map<string, Beat[]>();

  for (const beat of beats) {
    const state = normalizeOverviewState(beat.state);
    const group = byState.get(state) ?? [];
    group.push(beat);
    byState.set(state, group);
  }

  return [...byState.entries()]
    .sort(([left], [right]) =>
      compareWorkflowStatePriority(left, right)
    )
    .map(([state, group]) => ({
      state,
      beats: [...group].sort(compareBeatsByPriorityThenUpdated),
    }));
}

export function isOverviewBeat(beat: Beat): boolean {
  return beat.type.trim().toLowerCase() !== "lease";
}

export function filterOverviewBeats(
  beats: readonly Beat[],
): Beat[] {
  return beats.filter(isOverviewBeat);
}

export function countGroupedBeats(
  groups: readonly BeatStateGroup[],
): number {
  return groups.reduce(
    (total, group) => total + group.beats.length,
    0,
  );
}
