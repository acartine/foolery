import { useMemo } from "react";
import type { Beat } from "@/lib/types";
import {
  buildHierarchy,
  type HierarchicalBeat,
} from "@/lib/beat-hierarchy";
import {
  compareBeatsByHierarchicalOrder,
  compareBeatsByPriorityThenUpdated,
} from "@/lib/beat-sort";
import { isInternalLabel, isReadOnlyLabel } from "@/lib/wave-slugs";

function compareQueuedHierarchySiblings(
  a: Beat,
  b: Beat,
  parentId: string | undefined,
): number {
  if (parentId === undefined) {
    return compareBeatsByPriorityThenUpdated(a, b);
  }
  return compareBeatsByHierarchicalOrder(a, b);
}

export function useHierarchyData(
  data: Beat[],
  userSorted: boolean,
  sortTopLevelByPriorityUpdated = false,
) {
  return useMemo(() => {
    const sortFn = userSorted
      ? undefined
      : sortTopLevelByPriorityUpdated
        ? compareQueuedHierarchySiblings
        : compareBeatsByHierarchicalOrder;
    return buildHierarchy(data, sortFn);
  }, [data, userSorted, sortTopLevelByPriorityUpdated]);
}

export function useSortedData(
  hierarchyData: HierarchicalBeat[],
  expandedIds: Set<string>,
) {
  return useMemo(() => {
    const parentIds = new Set<string>();
    for (const beat of hierarchyData) {
      if (
        (
          beat as unknown as {
            _hasChildren?: boolean;
          }
        )._hasChildren
      ) {
        parentIds.add(beat.id);
      }
    }

    const result: HierarchicalBeat[] = [];
    let skipDepth: number | null = null;
    for (const beat of hierarchyData) {
      if (
        skipDepth !== null &&
        beat._depth > skipDepth
      ) {
        continue;
      }
      skipDepth = null;
      result.push(beat);
      if (
        parentIds.has(beat.id) &&
        !expandedIds.has(beat.id)
      ) {
        skipDepth = beat._depth;
      }
    }
    return result;
  }, [hierarchyData, expandedIds]);
}

export function usePaginatedData(
  sortedData: HierarchicalBeat[],
  pageSize: number,
  manualPageIndex: number,
) {
  return useMemo(() => {
    const groups: HierarchicalBeat[][] = [];
    let current: HierarchicalBeat[] | null = null;

    for (const beat of sortedData) {
      if (beat._depth === 0) {
        if (current) groups.push(current);
        current = [beat];
      } else {
        if (current) current.push(beat);
        else groups.push([beat]);
      }
    }
    if (current) groups.push(current);

    const pgCount = Math.max(
      1,
      Math.ceil(groups.length / pageSize),
    );
    const start = manualPageIndex * pageSize;
    const pageGroups = groups.slice(
      start,
      start + pageSize,
    );
    return {
      paginatedData: pageGroups.flat(),
      manualPageCount: pgCount,
    };
  }, [sortedData, pageSize, manualPageIndex]);
}

export function useAllLabels(data: Beat[]) {
  return useMemo(() => {
    const labelSet = new Set<string>();
    data.forEach((beat) =>
      beat.labels?.forEach((l) => {
        if (
          !isInternalLabel(l) &&
          !isReadOnlyLabel(l)
        ) {
          labelSet.add(l);
        }
      }),
    );
    return Array.from(labelSet).sort();
  }, [data]);
}

export function useChildCountMap(data: Beat[]) {
  return useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const beat of data) {
      if (beat.parent) {
        const list =
          childrenOf.get(beat.parent) ?? [];
        list.push(beat.id);
        childrenOf.set(beat.parent, list);
      }
    }
    const map = new Map<string, number>();
    function countDescendants(
      id: string,
    ): number {
      const kids = childrenOf.get(id);
      if (!kids) return 0;
      let total = 0;
      for (const kid of kids) {
        if (!childrenOf.has(kid)) total += 1;
        total += countDescendants(kid);
      }
      return total;
    }
    for (const pid of childrenOf.keys()) {
      const count = countDescendants(pid);
      if (count > 0) map.set(pid, count);
    }
    return map;
  }, [data]);
}

export function useCollapsedIds(
  hierarchyData: HierarchicalBeat[],
  expandedIds: Set<string>,
) {
  return useMemo(() => {
    const parentIds = new Set<string>();
    for (const beat of hierarchyData) {
      if (
        (
          beat as unknown as {
            _hasChildren?: boolean;
          }
        )._hasChildren
      ) {
        parentIds.add(beat.id);
      }
    }
    const collapsed = new Set<string>();
    for (const id of parentIds) {
      if (!expandedIds.has(id)) collapsed.add(id);
    }
    return collapsed;
  }, [hierarchyData, expandedIds]);
}

export function useParentRollingBeatIds(
  data: Beat[],
  shippingByBeatId: Record<string, string>,
) {
  return useMemo(() => {
    const childrenByParent = new Map<
      string,
      string[]
    >();
    for (const beat of data) {
      if (!beat.parent) continue;
      const children =
        childrenByParent.get(beat.parent) ?? [];
      children.push(beat.id);
      childrenByParent.set(beat.parent, children);
    }

    const ids = new Set<string>();
    const stack = Object.keys(
      shippingByBeatId,
    ).filter((id) =>
      Boolean(shippingByBeatId[id]),
    );

    while (stack.length > 0) {
      const parentId = stack.pop();
      if (!parentId) continue;
      const children =
        childrenByParent.get(parentId);
      if (!children) continue;

      for (const childId of children) {
        if (ids.has(childId)) continue;
        ids.add(childId);
        stack.push(childId);
      }
    }

    return ids;
  }, [data, shippingByBeatId]);
}
