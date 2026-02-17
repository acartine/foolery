"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchBeads } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import type { Bead, BdResult } from "@/lib/types";

/**
 * Returns the count of beads in the verification queue.
 *
 * Shares the same React Query cache entry as FinalCutView
 * (queryKey: ["beads", "finalcut", ...]) so:
 *  - Only one network request is made when both are mounted.
 *  - Invalidating ["beads"] also refreshes this count.
 *
 * @param enabled - pass false to suspend polling (e.g. when not on /beads).
 * @param isFinalCutActive - true when FinalCutView is the active view.
 *   When false the hook still polls but at a slower cadence (30s vs 10s),
 *   reducing background traffic on other /beads views.
 */
export function useVerificationCount(
  enabled: boolean,
  isFinalCutActive: boolean,
): number {
  const { activeRepo, registeredRepos } = useAppStore();

  const hasRepos = Boolean(activeRepo) || registeredRepos.length > 0;

  const { data } = useQuery<BdResult<Bead[]>, Error, number>({
    queryKey: ["beads", "finalcut", activeRepo, registeredRepos.length],
    queryFn: () => fetchVerificationBeads(activeRepo, registeredRepos),
    select: (result) => (result.ok ? (result.data?.length ?? 0) : 0),
    enabled: enabled && hasRepos,
    // When FinalCutView is active it drives the same cache at 10s;
    // on other views, poll at a relaxed 30s for the header badge.
    refetchInterval: isFinalCutActive ? 10_000 : 30_000,
  });

  return data ?? 0;
}

/**
 * Fetch in_progress beads with stage:verification across repos.
 *
 * NOTE: The multi-repo fan-out silences per-repo failures and returns
 * partial results. This matches FinalCutView's existing behaviour
 * (final-cut-view.tsx lines 51-65) and avoids hiding all results when
 * a single repo is temporarily unreachable.
 */
async function fetchVerificationBeads(
  activeRepo: string | null,
  registeredRepos: { path: string; name: string }[],
): Promise<BdResult<Bead[]>> {
  const params: Record<string, string> = { status: "in_progress" };

  if (activeRepo) {
    const result = await fetchBeads(params, activeRepo);
    if (result.ok && result.data) {
      const repo = registeredRepos.find((r) => r.path === activeRepo);
      result.data = result.data
        .filter((b) => b.labels?.includes("stage:verification"))
        .map((bead) => ({
          ...bead,
          _repoPath: activeRepo,
          _repoName: repo?.name ?? activeRepo,
        })) as typeof result.data;
    }
    return result;
  }

  if (registeredRepos.length > 0) {
    const results = await Promise.all(
      registeredRepos.map(async (repo) => {
        const result = await fetchBeads(params, repo.path);
        if (!result.ok || !result.data) return [];
        return result.data
          .filter((b) => b.labels?.includes("stage:verification"))
          .map((bead) => ({
            ...bead,
            _repoPath: repo.path,
            _repoName: repo.name,
          }));
      }),
    );
    return { ok: true, data: results.flat() };
  }

  const result = await fetchBeads(params);
  if (result.ok && result.data) {
    result.data = result.data.filter((b) =>
      b.labels?.includes("stage:verification"),
    );
  }
  return result;
}
