"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchBeads } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";

/**
 * Returns the current count of beads in the verification queue
 * (status: in_progress with label stage:verification).
 * Polls every 10 seconds, matching the FinalCutView refresh cadence.
 */
export function useVerificationCount(): number {
  const { activeRepo, registeredRepos } = useAppStore();

  const { data } = useQuery({
    queryKey: ["verification-count", activeRepo, registeredRepos.length],
    queryFn: async () => {
      const params: Record<string, string> = { status: "in_progress" };

      if (activeRepo) {
        const result = await fetchBeads(params, activeRepo);
        if (!result.ok || !result.data) return 0;
        return result.data.filter((b) =>
          b.labels?.includes("stage:verification")
        ).length;
      }

      if (registeredRepos.length > 0) {
        const results = await Promise.all(
          registeredRepos.map(async (repo) => {
            const result = await fetchBeads(params, repo.path);
            if (!result.ok || !result.data) return 0;
            return result.data.filter((b) =>
              b.labels?.includes("stage:verification")
            ).length;
          })
        );
        return results.reduce((sum, n) => sum + n, 0);
      }

      const result = await fetchBeads(params);
      if (!result.ok || !result.data) return 0;
      return result.data.filter((b) =>
        b.labels?.includes("stage:verification")
      ).length;
    },
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
  });

  return data ?? 0;
}
