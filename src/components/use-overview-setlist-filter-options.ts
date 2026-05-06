"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  beatRepoPath,
  buildOverviewSetlistFilterOptions,
} from "@/lib/beat-state-overview-filters";
import { fetchPlanSummaries } from "@/lib/plan-api";
import type { Beat } from "@/lib/types";

export function useOverviewSetlistFilterOptions(
  beats: readonly Beat[],
) {
  const repoPaths = useMemo(
    () => overviewRepoPaths(beats),
    [beats],
  );
  const planQueries = useQueries({
    queries: repoPaths.map((repoPath) => ({
      queryKey: ["overview-setlist-plans", repoPath],
      queryFn: () => fetchPlanSummaries(repoPath),
      enabled: repoPath.length > 0,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });

  const setlistOptions = useMemo(() => {
    return planQueries.flatMap((query, index) => {
      if (!query.data?.ok) return [];
      return buildOverviewSetlistFilterOptions(
        query.data.data ?? [],
        repoPaths[index],
      );
    });
  }, [planQueries, repoPaths]);

  const isLoading = planQueries.some((query) => query.isLoading);

  return { setlistOptions, isLoading };
}

function overviewRepoPaths(beats: readonly Beat[]): string[] {
  const repoPaths = new Set<string>();
  for (const beat of beats) {
    const repoPath = beatRepoPath(beat);
    if (repoPath) repoPaths.add(repoPath);
  }
  return [...repoPaths].sort();
}
