import { getBackend } from "@/lib/backend-instance";
import type { Beat } from "@/lib/types";

const TERMINAL_CHILD_STATES = new Set(["closed", "shipped", "abandoned"]);

function isTerminalChildState(state: string | undefined): boolean {
  if (!state) return false;
  return TERMINAL_CHILD_STATES.has(state);
}

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
 * After a beat is closed (or otherwise changes state), walk the hierarchy
 * starting at that beat and auto-close any parent-like node whose children are
 * all terminal.
 *
 * This cascades upward: closing one node may in turn satisfy its parent.
 *
 * Errors are caught and logged — regroom never fails the caller.
 */
export async function regroomAncestors(
  beatId: string,
  repoPath?: string
): Promise<void> {
  try {
    // Single call with no state filter gets --all (see bd.ts listBeats)
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
    const hierarchyIds = [beatId, ...getAncestors(beatId, beatsById)];

    for (const currentId of hierarchyIds) {
      const current = beatsById.get(currentId);
      if (current && isTerminalChildState(current.state)) continue;

      const children = childrenIndex.get(currentId);
      if (!children || children.length === 0) continue;

      const allTerminal = children.every((child) => isTerminalChildState(child.state));
      if (!allTerminal) break; // stop walking up — this ancestor still has open work

      console.log(
        `[regroom] Auto-closing ${currentId} — all ${children.length} children are terminal`
      );
      const result = await getBackend().close(currentId, undefined, repoPath);
      if (!result.ok) {
        console.error(
          `[regroom] Failed to close ${currentId}: ${result.error?.message}`
        );
        break;
      }

      // Update our in-memory map so the next ancestor check sees this as closed
      if (current) {
        current.state = "closed";
        beatsById.set(currentId, current);
      }
    }
  } catch (err) {
    console.error(
      `[regroom] Error during regroomAncestors(${beatId}):`,
      err
    );
  }
}
