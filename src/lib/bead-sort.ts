import type { Bead } from "@/lib/types";

/**
 * Natural string comparison that treats embedded numeric segments as numbers.
 * "bead-2" < "bead-10" (unlike localeCompare which gives "bead-10" < "bead-2").
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

function statusSortRank(status: Bead["status"]): number {
  switch (status) {
    case "open":
      return 0;
    case "in_progress":
      return 1;
    case "closed":
      return 2;
    default:
      return 3;
  }
}

export function compareBeadsByPriorityThenStatus(a: Bead, b: Bead): number {
  if (a.priority !== b.priority) return a.priority - b.priority;

  const statusDiff = statusSortRank(a.status) - statusSortRank(b.status);
  if (statusDiff !== 0) return statusDiff;

  const titleDiff = a.title.localeCompare(b.title);
  if (titleDiff !== 0) return titleDiff;

  return a.id.localeCompare(b.id);
}

/**
 * Sort beads by natural ID order — the proper sort for hierarchical siblings.
 * Children of a parent appear in their natural sequential order (1, 2, 3, ...)
 * regardless of individual priority or status.
 */
export function compareBeadsByHierarchicalOrder(a: Bead, b: Bead): number {
  return naturalCompare(a.id, b.id);
}
