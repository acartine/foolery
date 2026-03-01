import type { Beat } from "@/lib/types";

export interface HierarchicalBeat extends Beat {
  _depth: number;
  _hasChildren: boolean;
}

/**
 * Takes a flat list of beats and returns them sorted in parent-first DFS order,
 * with a `_depth` field indicating nesting level.
 * Beats whose parent ID is not in the dataset are treated as top-level.
 * Circular references are skipped via a visited set.
 *
 * An optional `sortChildren` comparator reorders siblings within each parent
 * group without breaking the hierarchy (children never escape their subtree).
 */
export function buildHierarchy(
  beats: Beat[],
  sortChildren?: (a: Beat, b: Beat) => number,
): HierarchicalBeat[] {
  const byId = new Map(beats.map((b) => [b.id, b]));
  const children = new Map<string | undefined, Beat[]>();

  for (const b of beats) {
    const parentKey = b.parent && byId.has(b.parent) ? b.parent : undefined;
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey)!.push(b);
  }

  const result: HierarchicalBeat[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | undefined, depth: number) {
    const kids = children.get(parentId) ?? [];
    if (sortChildren) kids.sort(sortChildren);
    for (const b of kids) {
      if (visited.has(b.id)) continue;
      visited.add(b.id);
      const hasKids = (children.get(b.id) ?? []).length > 0;
      result.push({ ...b, _depth: depth, _hasChildren: hasKids });
      walk(b.id, depth + 1);
    }
  }

  walk(undefined, 0);
  return result;
}
