"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { BeatTable } from "@/components/beat-table";
import { PerfProfiler } from "@/components/perf-profiler";
import { withClientPerfSpan } from "@/lib/client-perf";
import { useAppStore } from "@/stores/app-store";
import type { Beat } from "@/lib/types";
import { useBeatsScreenWarmup } from "@/hooks/use-beats-screen-warmup";
import { RepoSwitchLoadingState } from "@/components/repo-switch-loading-state";
import { useRepoSwitchQueryState } from "@/hooks/use-repo-switch-query-state";

const HUMAN_ACTION_PARAMS: Record<string, string> = {
  requiresHumanAction: "true",
};

export function FinalCutView() {
  const { activeRepo, registeredRepos } = useAppStore();
  const [selectionVersion] = useState(0);
  const scope = resolveBeatsScope(activeRepo, registeredRepos);

  const query = useQuery({
    queryKey: buildBeatsQueryKey(
      "finalcut",
      HUMAN_ACTION_PARAMS,
      scope,
    ),
    queryFn: () => withClientPerfSpan(
      "query",
      "beats:finalcut",
      () => fetchBeatsForScope(
        HUMAN_ACTION_PARAMS,
        scope,
        registeredRepos,
      ),
    ),
    enabled: Boolean(activeRepo) || registeredRepos.length > 0,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const {
    data,
    isLoading,
  } = useRepoSwitchQueryState(scope.key, {
    data: query.data,
    error: query.error,
    fetchStatus: query.fetchStatus,
    isFetched: query.isFetched,
    isLoading: query.isLoading,
  });
  useBeatsScreenWarmup(
    "finalcut",
    !isLoading && data?.ok === true,
  );

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
              <Megaphone className="size-4" />
              Escalations
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Knots and beats that require a human-owned next step.
              This queue is explicit from profile ownership and state.
            </p>
          </div>
          <Badge variant="outline" className="border-feature-400 bg-feature-100 text-feature-700">
            {beats.length} {beats.length === 1 ? "beat" : "beats"}
          </Badge>
        </div>
      </section>

      {isLoading ? (
        <RepoSwitchLoadingState
          data-testid="repo-switch-loading-finalcut"
          label="Loading escalations queue..."
        />
      ) : (
        <PerfProfiler id="final-cut-view" interactionLabel="escalations" beatCount={beats.length}>
          <BeatTable
            data={beats}
            showRepoColumn={showRepoColumn}
            onSelectionChange={handleSelectionChange}
            selectionVersion={selectionVersion}
          />
        </PerfProfiler>
      )}
    </div>
  );
}
