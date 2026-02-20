"use client";

import { useCallback, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchBeads } from "@/lib/api";
import { BeadTable } from "@/components/bead-table";
import { useAppStore } from "@/stores/app-store";
import { useVerificationNotifications } from "@/hooks/use-verification-notifications";
import type { Bead } from "@/lib/types";

export function FinalCutView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const [selectionVersion] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["beads", "finalcut", activeRepo, registeredRepos.length],
    queryFn: async () => {
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
          })
        );
        return { ok: true, data: results.flat() };
      }
      const result = await fetchBeads(params);
      if (result.ok && result.data) {
        result.data = result.data.filter((b) => b.labels?.includes("stage:verification"));
      }
      return result;
    },
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const beads: Bead[] = data?.ok ? (data.data ?? []) : [];
  useVerificationNotifications(beads);
  const showRepoColumn = !activeRepo && registeredRepos.length > 1;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSelectionChange = useCallback((_ids: string[]) => {
    // selection tracked for potential bulk actions
  }, []);

  return (
    <div>
      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          Loading final cut...
        </div>
      ) : (
        <BeadTable
          data={beads}
          showRepoColumn={showRepoColumn}
          onSelectionChange={handleSelectionChange}
          selectionVersion={selectionVersion}
        />
      )}
    </div>
  );
}
