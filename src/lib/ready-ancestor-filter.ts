import type { Beat } from "@/lib/types";

/**
 * Keep only beats whose entire parent chain exists in the same dataset.
 * This prevents ready descendants from surfacing as top-level rows when an
 * intermediate ancestor is excluded (for example: blocked/not-ready parent).
 */
export function filterByVisibleAncestorChain(beats: Beat[]): Beat[] {
  const byId = new Map(beats.map((beat) => [beat.id, beat]));
  const cache = new Map<string, boolean>();
  const visiting = new Set<string>();

  function hasVisibleChain(beat: Beat): boolean {
    if (cache.has(beat.id)) return cache.get(beat.id) ?? false;
    if (visiting.has(beat.id)) {
      cache.set(beat.id, false);
      return false;
    }

    visiting.add(beat.id);
    let visible = true;

    if (beat.parent) {
      const parent = byId.get(beat.parent);
      visible = parent ? hasVisibleChain(parent) : false;
    }

    visiting.delete(beat.id);
    cache.set(beat.id, visible);
    return visible;
  }

  return beats.filter((beat) => hasVisibleChain(beat));
}
