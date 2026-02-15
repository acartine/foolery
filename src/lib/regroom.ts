import { listBeads, closeBead } from "@/lib/bd";
import type { Bead } from "@/lib/types";

/**
 * Build a map of parentId → immediate children from a flat bead list.
 */
function buildChildrenIndex(beads: Bead[]): Map<string, Bead[]> {
  const byParent = new Map<string, Bead[]>();
  for (const bead of beads) {
    if (!bead.parent) continue;
    const list = byParent.get(bead.parent) ?? [];
    list.push(bead);
    byParent.set(bead.parent, list);
  }
  return byParent;
}

/**
 * Walk up the hierarchy from a bead, collecting ancestor IDs (bottom-up).
 * Guards against cycles with a visited set.
 */
function getAncestors(beadId: string, beadsById: Map<string, Bead>): string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = beadsById.get(beadId);
  while (current?.parent && !visited.has(current.parent)) {
    visited.add(current.parent);
    ancestors.push(current.parent);
    current = beadsById.get(current.parent);
  }
  return ancestors;
}

/**
 * After a bead is closed (or otherwise changes state), walk up the hierarchy
 * and auto-close any parent whose children are ALL closed.
 *
 * This cascades upward: closing a parent may in turn satisfy *its* parent.
 *
 * Errors are caught and logged — regroom never fails the caller.
 */
export async function regroomAncestors(
  beadId: string,
  repoPath?: string
): Promise<void> {
  try {
    // Single call with no status filter gets --all (see bd.ts listBeads)
    const allResult = await listBeads({}, repoPath);
    const allBeads: Bead[] = allResult.ok && allResult.data ? allResult.data : [];

    // Deduplicate by ID
    const beadsById = new Map<string, Bead>();
    for (const bead of allBeads) {
      beadsById.set(bead.id, bead);
    }

    const childrenIndex = buildChildrenIndex(
      Array.from(beadsById.values())
    );
    const ancestors = getAncestors(beadId, beadsById);

    for (const ancestorId of ancestors) {
      const children = childrenIndex.get(ancestorId);
      if (!children || children.length === 0) continue;

      const allClosed = children.every((child) => child.status === "closed");
      if (!allClosed) break; // stop walking up — this ancestor still has open work

      console.log(
        `[regroom] Auto-closing ${ancestorId} — all ${children.length} children closed`
      );
      const result = await closeBead(ancestorId, undefined, repoPath);
      if (!result.ok) {
        console.error(
          `[regroom] Failed to close ${ancestorId}: ${result.error}`
        );
        break;
      }

      // Update our in-memory map so the next ancestor check sees this as closed
      const ancestor = beadsById.get(ancestorId);
      if (ancestor) {
        beadsById.set(ancestorId, { ...ancestor, status: "closed" });
      }
    }
  } catch (err) {
    console.error(
      `[regroom] Error during regroomAncestors(${beadId}):`,
      err
    );
  }
}
