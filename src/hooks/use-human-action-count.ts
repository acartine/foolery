"use client";

import { useQuery } from "@tanstack/react-query";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
} from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import type { Beat, BdResult } from "@/lib/types";

const HUMAN_ACTION_PARAMS: Record<string, string> = {
  requiresHumanAction: "true",
};

/**
 * Returns the count of beats requiring human action.
 *
 * Shares the same React Query cache entry as FinalCutView so the header badge
 * does not trigger a second request when the Final Cut screen is active.
 */
export function useHumanActionCount(
  enabled: boolean,
  isFinalCutActive: boolean,
): number {
  const { activeRepo, registeredRepos } = useAppStore();
  const scope = resolveBeatsScope(activeRepo, registeredRepos);
  const hasRepos = Boolean(activeRepo) || registeredRepos.length > 0;
  const refreshMs = isFinalCutActive ? 10_000 : 30_000;

  const { data } = useQuery<BdResult<Beat[]>, Error, number>({
    queryKey: buildBeatsQueryKey(
      "finalcut",
      HUMAN_ACTION_PARAMS,
      scope,
    ),
    queryFn: () => fetchBeatsForScope(
      HUMAN_ACTION_PARAMS,
      scope,
      registeredRepos,
    ),
    select: (result) => {
      if (!result.ok || !result.data) return 0;
      const parentIds = new Set(
        result.data.map((beat) => beat.parent).filter(Boolean),
      );
      return result.data.filter(
        (beat) => !beat.parent || parentIds.has(beat.id),
      ).length;
    },
    enabled: enabled && hasRepos,
    staleTime: refreshMs,
    refetchInterval: refreshMs,
  });

  return data ?? 0;
}
