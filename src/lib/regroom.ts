import { getBackend } from "@/lib/backend-instance";
import type { Beat } from "@/lib/types";

/**
 * Build a map of parentId → immediate children from a flat beat list.
 */
function buildChildrenIndex(beats: Beat[]): Map<string, Beat[]> {
  const byParent = new Map<string, Beat[]>();
  for (const beat of beats) {
    if (!beat.parent) continue;
    const list = byParent.get(beat.parent) ?? [];
    list.push(beat);
    byParent.set(beat.parent, list);
  }
  return byParent;
}

/**
 * Walk up the hierarchy from a beat, collecting ancestor IDs (bottom-up).
 * Guards against cycles with a visited set.
 */
function getAncestors(beatId: string, beatsById: Map<string, Beat>): string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = beatsById.get(beatId);
  while (current?.parent && !visited.has(current.parent)) {
    visited.add(current.parent);
    ancestors.push(current.parent);
    current = beatsById.get(current.parent);
  }
  return ancestors;
}

/**
 * After a beat is closed (or otherwise changes state), walk up the hierarchy
 * and auto-close any parent whose children are ALL closed.
 *
 * This cascades upward: closing a parent may in turn satisfy *its* parent.
 *
 * Errors are caught and logged — regroom never fails the caller.
 */
export async function regroomAncestors(
  beatId: string,
  repoPath?: string
): Promise<void> {
  try {
    // Single call with no state filter gets --all (see bd.ts listBeads)
    const allResult = await getBackend().list({}, repoPath);
    const allBeats: Beat[] = allResult.ok && allResult.data ? allResult.data : [];

    // Deduplicate by ID
    const beatsById = new Map<string, Beat>();
    for (const beat of allBeats) {
      beatsById.set(beat.id, beat);
    }

    const childrenIndex = buildChildrenIndex(
      Array.from(beatsById.values())
    );
    const ancestors = getAncestors(beatId, beatsById);

    for (const ancestorId of ancestors) {
      const children = childrenIndex.get(ancestorId);
      if (!children || children.length === 0) continue;

      const allClosed = children.every((child) => child.state === "closed");
      if (!allClosed) break; // stop walking up — this ancestor still has open work

      console.log(
        `[regroom] Auto-closing ${ancestorId} — all ${children.length} children closed`
      );
      const result = await getBackend().close(ancestorId, undefined, repoPath);
      if (!result.ok) {
        console.error(
          `[regroom] Failed to close ${ancestorId}: ${result.error?.message}`
        );
        break;
      }

      // Update our in-memory map so the next ancestor check sees this as closed
      const ancestor = beatsById.get(ancestorId);
      if (ancestor) {
        beatsById.set(ancestorId, { ...ancestor, state: "closed" });
      }
    }
  } catch (err) {
    console.error(
      `[regroom] Error during regroomAncestors(${beatId}):`,
      err
    );
  }
}
