import { getBackend } from "@/lib/backend-instance";
import {
  listBeatsAcrossRegisteredRepos,
} from "@/lib/beats-multi-repo";
import {
  getStaleBeatSummaries,
  selectOldestStaleBeatSummaries,
} from "@/lib/stale-beat-grooming";
import type { Beat } from "@/lib/types";
import type {
  StaleBeatSummary,
} from "@/lib/stale-beat-grooming-types";

export interface ListStaleBeatsInput {
  repoPath?: string;
  scope?: string;
  ageDays?: number;
  limit?: number;
  nowMs?: number;
}

export async function listStaleBeatSummariesForApi(
  input: ListStaleBeatsInput = {},
): Promise<StaleBeatSummary[]> {
  const beats = await listSourceBeats(input);
  const summaries = getStaleBeatSummaries(
    beats,
    input.nowMs ?? Date.now(),
    input.ageDays,
  );
  if (!input.limit) return summaries;
  return selectOldestStaleBeatSummaries(summaries, input.limit);
}

async function listSourceBeats(
  input: ListStaleBeatsInput,
): Promise<Beat[]> {
  if (input.scope === "all" && !input.repoPath) {
    const result = await listBeatsAcrossRegisteredRepos({}, undefined);
    if (!result.ok) {
      throw new Error(result.error ?? "Failed to list beats");
    }
    return result.data ?? [];
  }

  const result = await getBackend().list({}, input.repoPath);
  if (!result.ok) {
    const message = result.error?.message ?? "Failed to list beats";
    throw new Error(message);
  }
  return result.data ?? [];
}
