import { listBeads, closeBead } from "@/lib/bd";
import type { Bead, BdResult } from "@/lib/types";

/**
 * Minimal info about a descendant bead for confirmation display.
 */
export interface CascadeDescendant {
  id: string;
  title: string;
  status: string;
}

/**
 * Collect all open descendant beads of a given parent, recursively.
 *
 * Returns descendants in leaf-first (bottom-up) order so callers can
 * close them before their parents without ordering concerns.
 */
export async function getOpenDescendants(
  parentId: string,
  repoPath?: string,
): Promise<BdResult<CascadeDescendant[]>> {
  const allResult = await listBeads({}, repoPath);
  if (!allResult.ok || !allResult.data) {
    return { ok: false, error: allResult.error ?? "Failed to list beads" };
  }

  const childrenIndex = new Map<string, Bead[]>();
  for (const bead of allResult.data) {
    if (!bead.parent) continue;
    const list = childrenIndex.get(bead.parent) ?? [];
    list.push(bead);
    childrenIndex.set(bead.parent, list);
  }

  const descendants: CascadeDescendant[] = [];
  collectDescendants(parentId, childrenIndex, descendants);
  return { ok: true, data: descendants };
}

/**
 * Recursively collect open descendants depth-first, appending in
 * leaf-first (post-order) so the deepest children appear first.
 */
function collectDescendants(
  parentId: string,
  childrenIndex: Map<string, Bead[]>,
  result: CascadeDescendant[],
): void {
  const children = childrenIndex.get(parentId);
  if (!children) return;
  for (const child of children) {
    // Recurse first to get leaf-first ordering
    collectDescendants(child.id, childrenIndex, result);
    if (child.status !== "closed") {
      result.push({ id: child.id, title: child.title, status: child.status });
    }
  }
}

/**
 * Close a parent bead and all its open descendants recursively.
 *
 * Closes in leaf-first order (deepest children first, then up to the parent).
 * Errors on individual children are collected but do not block siblings.
 */
export async function cascadeClose(
  parentId: string,
  reason?: string,
  repoPath?: string,
): Promise<BdResult<{ closed: string[]; errors: string[] }>> {
  const descResult = await getOpenDescendants(parentId, repoPath);
  if (!descResult.ok || !descResult.data) {
    return { ok: false, error: descResult.error ?? "Failed to list descendants" };
  }

  const closed: string[] = [];
  const errors: string[] = [];

  // Close descendants leaf-first
  for (const desc of descResult.data) {
    const result = await closeBead(desc.id, reason, repoPath);
    if (result.ok) {
      closed.push(desc.id);
    } else {
      errors.push(`${desc.id}: ${result.error}`);
    }
  }

  // Close the parent itself
  const parentResult = await closeBead(parentId, reason, repoPath);
  if (parentResult.ok) {
    closed.push(parentId);
  } else {
    errors.push(`${parentId}: ${parentResult.error}`);
  }

  return { ok: true, data: { closed, errors } };
}
