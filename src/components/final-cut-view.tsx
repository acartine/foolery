"use client";

import { useCallback, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Scissors } from "lucide-react";
import { fetchBeats } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { BeatTable } from "@/components/beat-table";
import { useAppStore } from "@/stores/app-store";
import type { Beat } from "@/lib/types";

export function FinalCutView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const [selectionVersion] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["beats", "human-action", activeRepo, registeredRepos.length],
    queryFn: async () => {
      const params: Record<string, string> = { requiresHumanAction: "true" };
      if (activeRepo) {
        const result = await fetchBeats(params, activeRepo);
        if (result.ok && result.data) {
          const repo = registeredRepos.find((r) => r.path === activeRepo);
          result.data = result.data
            .map((beat) => ({
              ...beat,
              _repoPath: activeRepo,
              _repoName: repo?.name ?? activeRepo,
            })) as typeof result.data;
        }
        return result;
      }
      if (registeredRepos.length > 0) {
        const results = await Promise.all(
          registeredRepos.map(async (repo) => {
            const result = await fetchBeats(params, repo.path);
            if (!result.ok || !result.data) return [];
            return result.data
              .map((beat) => ({
                ...beat,
                _repoPath: repo.path,
                _repoName: repo.name,
              }));
          })
        );
        return { ok: true, data: results.flat() };
      }
      return fetchBeats(params);
    },
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const allBeats: Beat[] = data?.ok ? (data.data ?? []) : [];

  // Only show top-level beats (no parent) and parent beats (have children).
  // Leaf children are excluded to reduce clutter in the Final Cut view.
  const parentIds = new Set(allBeats.map((b) => b.parent).filter(Boolean));
  const beats = allBeats.filter((b) => !b.parent || parentIds.has(b.id));

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
              Knots and beats that require a human-owned next step.
              This queue is explicit from profile ownership and state.
            </p>
          </div>
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
            {beats.length} {beats.length === 1 ? "beat" : "beats"}
          </Badge>
        </div>
      </section>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          Loading human action queue...
        </div>
      ) : (
        <BeatTable
          data={beats}
          showRepoColumn={showRepoColumn}
          onSelectionChange={handleSelectionChange}
          selectionVersion={selectionVersion}
        />
      )}
    </div>
  );
}
