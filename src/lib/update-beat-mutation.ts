import { updateBead } from "@/lib/api";
import type { UpdateBeatInput } from "@/lib/schemas";
import type { Beat } from "@/lib/types";

function normalizeRepoPath(repoPath: unknown): string | undefined {
  if (typeof repoPath !== "string") return undefined;
  const normalized = repoPath.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function repoPathForBeat(beat: Beat | undefined): string | undefined {
  const record = beat as (Beat & { _repoPath?: unknown }) | undefined;
  return normalizeRepoPath(record?._repoPath);
}

/**
 * Update a beat and throw when the backend rejects the mutation.
 * React Query mutation handlers rely on throws to enter onError.
 */
export async function updateBeatOrThrow(
  beats: Beat[],
  id: string,
  fields: UpdateBeatInput,
  repoPath?: string,
): Promise<void> {
  const beat = beats.find((entry) => entry.id === id);
  const resolvedRepoPath = normalizeRepoPath(repoPath) ?? repoPathForBeat(beat);
  const result = await updateBead(id, fields, resolvedRepoPath);
  if (!result.ok) {
    throw new Error(result.error ?? "Failed to update beat");
  }
}
