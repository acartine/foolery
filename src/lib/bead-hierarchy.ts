import type { Bead } from "@/lib/types";

export interface HierarchicalBead extends Bead {
  _depth: number;
}

/**
 * Takes a flat list of beads and returns them sorted in parent-first DFS order,
 * with a `_depth` field indicating nesting level.
 * Beads whose parent ID is not in the dataset are treated as top-level.
 * Circular references are skipped via a visited set.
 */
export function buildHierarchy(beads: Bead[]): HierarchicalBead[] {
  const byId = new Map(beads.map((b) => [b.id, b]));
  const children = new Map<string | undefined, Bead[]>();

  for (const b of beads) {
    const parentKey = b.parent && byId.has(b.parent) ? b.parent : undefined;
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey)!.push(b);
  }

  const result: HierarchicalBead[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | undefined, depth: number) {
    for (const b of children.get(parentId) ?? []) {
      if (visited.has(b.id)) continue;
      visited.add(b.id);
      result.push({ ...b, _depth: depth });
      walk(b.id, depth + 1);
    }
  }

  walk(undefined, 0);
  return result;
}
