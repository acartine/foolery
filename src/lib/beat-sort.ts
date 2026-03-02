import type { Beat } from "@/lib/types";
import { resolveStep, StepPhase } from "@/lib/workflows";

/**
 * Natural string comparison that treats embedded numeric segments as numbers.
 * "beat-2" < "beat-10" (unlike localeCompare which gives "beat-10" < "beat-2").
 */
export function naturalCompare(a: string, b: string): number {
  const parts = /(\d+)/;
  const aParts = a.split(parts);
  const bParts = b.split(parts);

  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    if (i % 2 === 1) {
      // Numeric segment (odd indices from split with capture group)
      const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
      if (diff !== 0) return diff;
    } else {
      const diff = aParts[i].localeCompare(bParts[i]);
      if (diff !== 0) return diff;
    }
  }

  return aParts.length - bParts.length;
}

function stateSortRank(state: Beat["state"]): number {
  const resolved = resolveStep(state);
  if (resolved) {
    if (resolved.phase === StepPhase.Queued) return 0;
    // Active non-review → 1, active review → 2
    return resolved.step.endsWith("_review") ? 2 : 1;
  }
  if (state === "shipped" || state === "abandoned" || state === "closed") return 3;
  if (state === "deferred" || state === "blocked") return 4;
  return 5;
}

export function compareBeatsByPriorityThenState(a: Beat, b: Beat): number {
  if (a.priority !== b.priority) return a.priority - b.priority;

  const stateDiff = stateSortRank(a.state) - stateSortRank(b.state);
  if (stateDiff !== 0) return stateDiff;

  const titleDiff = a.title.localeCompare(b.title);
  if (titleDiff !== 0) return titleDiff;

  return a.id.localeCompare(b.id);
}

/**
 * Sort beats by natural ID order — the proper sort for hierarchical siblings.
 * Children of a parent appear in their natural sequential order (1, 2, 3, ...)
 * regardless of individual priority or state.
 */
export function compareBeatsByHierarchicalOrder(a: Beat, b: Beat): number {
  return naturalCompare(a.id, b.id);
}
