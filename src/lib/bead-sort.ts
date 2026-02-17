import type { Bead } from "@/lib/types";

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
