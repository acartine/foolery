import { getBackend } from "@/lib/backend-instance";
import type { BackendResult } from "@/lib/backend-port";
import type { Beat } from "@/lib/types";

/**
 * Minimal info about a descendant beat for confirmation display.
 */
export interface CascadeDescendant {
  id: string;
  title: string;
  state: string;
}

/**
 * Collect all open descendant beats of a given parent, recursively.
 *
 * Returns descendants in leaf-first (bottom-up) order so callers can
 * close them before their parents without ordering concerns.
 */
export async function getOpenDescendants(
  parentId: string,
  repoPath?: string,
): Promise<BackendResult<CascadeDescendant[]>> {
  const allResult = await getBackend().list(undefined, repoPath);
  if (!allResult.ok || !allResult.data) {
    return { ok: false, error: allResult.error ?? { code: "INTERNAL", message: "Failed to list beats", retryable: false } };
  }

  const childrenIndex = new Map<string, Beat[]>();
  for (const beat of allResult.data) {
    if (!beat.parent) continue;
    const list = childrenIndex.get(beat.parent) ?? [];
    list.push(beat);
    childrenIndex.set(beat.parent, list);
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
  childrenIndex: Map<string, Beat[]>,
  result: CascadeDescendant[],
): void {
  const children = childrenIndex.get(parentId);
  if (!children) return;
  for (const child of children) {
    // Recurse first to get leaf-first ordering
    collectDescendants(child.id, childrenIndex, result);
    if (child.state !== "closed") {
      result.push({ id: child.id, title: child.title, state: child.state });
    }
  }
}

/**
 * Close a parent beat and all its open descendants recursively.
 *
 * Closes in leaf-first order (deepest children first, then up to the parent).
 * Errors on individual children are collected but do not block siblings.
 */
export async function cascadeClose(
  parentId: string,
  reason?: string,
  repoPath?: string,
): Promise<BackendResult<{ closed: string[]; errors: string[] }>> {
  const descResult = await getOpenDescendants(parentId, repoPath);
  if (!descResult.ok || !descResult.data) {
    return { ok: false, error: descResult.error ?? { code: "INTERNAL", message: "Failed to list descendants", retryable: false } };
  }

  const backend = getBackend();
  const closed: string[] = [];
  const errors: string[] = [];

  // Close descendants leaf-first
  for (const desc of descResult.data) {
    const result = await backend.close(desc.id, reason, repoPath);
    if (result.ok) {
      closed.push(desc.id);
    } else {
      errors.push(`${desc.id}: ${result.error?.message}`);
    }
  }

  // Close the parent itself
  const parentResult = await backend.close(parentId, reason, repoPath);
  if (parentResult.ok) {
    closed.push(parentId);
  } else {
    errors.push(`${parentId}: ${parentResult.error?.message}`);
  }

  return { ok: true, data: { closed, errors } };
}
