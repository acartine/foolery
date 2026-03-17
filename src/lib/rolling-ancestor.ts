import type { Beat } from "@/lib/types";

/**
 * Walk the parent chain of a beat and return true if any ancestor
 * is currently rolling (has an active session in shippingByBeatId).
 *
 * parentByBeatId must be built from the *full* beat set for a repo,
 * not a filtered subset — otherwise intermediate parents that are
 * not in the subset will break the chain and miss rolling grandparents.
 */
export function hasRollingAncestor(
  beat: Pick<Beat, "id" | "parent">,
  parentByBeatId: Map<string, string | undefined>,
  shippingByBeatId: Record<string, string>,
): boolean {
  let parentId = beat.parent;
  const visited = new Set<string>();

  while (parentId) {
    if (shippingByBeatId[parentId]) return true;
    if (visited.has(parentId)) break;
    visited.add(parentId);
    parentId = parentByBeatId.get(parentId);
  }

  return false;
}
