"use client";

import { useCallback, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Scissors } from "lucide-react";
import { fetchBeads } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { BeadTable } from "@/components/bead-table";
import { useAppStore } from "@/stores/app-store";
import { useVerificationNotifications } from "@/hooks/use-verification-notifications";
import type { Bead } from "@/lib/types";

export function FinalCutView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const [selectionVersion] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["beads", "human-action", activeRepo, registeredRepos.length],
    queryFn: async () => {
      const params: Record<string, string> = { requiresHumanAction: "true" };
      if (activeRepo) {
        const result = await fetchBeads(params, activeRepo);
        if (result.ok && result.data) {
          const repo = registeredRepos.find((r) => r.path === activeRepo);
          result.data = result.data
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
              .map((bead) => ({
                ...bead,
                _repoPath: repo.path,
                _repoName: repo.name,
              }));
          })
        );
        return { ok: true, data: results.flat() };
      }
      return fetchBeads(params);
    },
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const allBeads: Bead[] = data?.ok ? (data.data ?? []) : [];

  // Only show top-level beads (no parent) and parent beads (have children).
  // Leaf children are excluded to reduce clutter in the Final Cut view.
  const parentIds = new Set(allBeads.map((b) => b.parent).filter(Boolean));
  const beads = allBeads.filter((b) => !b.parent || parentIds.has(b.id));

  useVerificationNotifications(beads);
  const showRepoColumn = !activeRepo && registeredRepos.length > 1;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSelectionChange = useCallback((_ids: string[]) => {
    // selection tracked for potential bulk actions
  }, []);

  return (
    <div className="space-y-4 pb-4">
      <section className="rounded-2xl border bg-gradient-to-br from-slate-50 via-amber-50 to-orange-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Scissors className="size-4" />
              Human Action
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Knots and beads that require a human-owned next step.
              This queue is explicit from profile ownership and state.
            </p>
          </div>
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
            {beads.length} {beads.length === 1 ? "bead" : "beads"}
          </Badge>
        </div>
      </section>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          Loading human action queue...
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
