import type { Beat } from "@/lib/types";

/**
 * Keep the directly matched active beats plus every ancestor in each matched
 * beat's parent chain, preserving the original beat ordering.
 */
export function includeActiveAncestors(allBeats: Beat[], activeBeats: Beat[]): Beat[] {
  if (activeBeats.length === 0) return activeBeats;

  const includedIds = new Set(activeBeats.map((beat) => beat.id));
  const parentByBeatId = new Map(allBeats.map((beat) => [beat.id, beat.parent]));

  for (const beat of activeBeats) {
    let parentId = beat.parent;
    const visited = new Set<string>();

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      includedIds.add(parentId);
      parentId = parentByBeatId.get(parentId);
    }
  }

  return allBeats.filter((beat) => includedIds.has(beat.id));
}
