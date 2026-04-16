"use client";

import {
  useMemo,
  useState,
} from "react";
import {
  type UseQueryResult,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import {
  GitBranch,
  ListMusic,
  Music4,
} from "lucide-react";
import { SetlistChartPanel } from "@/components/setlist-chart-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fetchBeat } from "@/lib/api";
import { fetchPlan, fetchPlanSummaries, fetchRepoBeats } from "@/lib/plan-api";
import {
  buildSetlistChart,
  buildSetlistPlanPreview,
  countWorkableSetlistRows,
} from "@/lib/setlist-chart";
import type { PlanRecord, PlanSummary } from "@/lib/orchestration-plan-types";
import type { BdResult, Beat } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SetlistView({
  repoPath,
}: {
  repoPath?: string;
}) {
  const [requestedPlanId, setRequestedPlanId] = useState<string | null>(null);
  const {
    plansQuery,
    beatsQuery,
    planSummaries,
    previews,
    summaryBeatMap,
  } = useSetlistBaseData(repoPath);
  const selectedPlanId = useMemo(
    () => resolveSelectedPlanId(requestedPlanId, planSummaries),
    [planSummaries, requestedPlanId],
  );
  const { planQuery, selectedPlanRecord, chart } = useSelectedPlanData(
    repoPath,
    selectedPlanId,
    summaryBeatMap,
  );
  const emptyState = getEmptySetlistState(
    repoPath,
    plansQuery.isLoading || beatsQuery.isLoading,
    plansQuery.data?.ok,
    beatsQuery.data?.ok,
    plansQuery.data?.error,
    beatsQuery.data?.error,
    planSummaries.length,
  );

  return emptyState ? (
    <EmptySetlistState
      title={emptyState.title}
      description={emptyState.description}
    />
  ) : (
    <LoadedSetlistView
      repoPath={repoPath}
      planSummaries={planSummaries}
      previews={previews}
      selectedPlanId={selectedPlanId}
      selectedWorkableBeatCount={
        chart
          ? countWorkableSetlistRows(chart)
          : null
      }
      onSelectPlan={setRequestedPlanId}
      planQuery={planQuery}
      selectedPlanRecord={selectedPlanRecord}
      chart={chart}
    />
  );
}

function getEmptySetlistState(
  repoPath: string | undefined,
  isLoading: boolean,
  plansOk: boolean | undefined,
  beatsOk: boolean | undefined,
  plansError: string | undefined,
  beatsError: string | undefined,
  planCount: number,
): { title: string; description: string } | null {
  if (!repoPath) {
    return {
      title: "Choose a repo for Setlist",
      description:
        "Setlist needs one active repository so it can load"
        + " persisted execution plans and beat priorities.",
    };
  }
  if (isLoading) {
    return {
      title: "Loading setlist",
      description:
        "Pulling execution plans and beat metadata for the selected repository.",
    };
  }
  if (!plansOk) {
    return {
      title: "Couldn’t load execution plans",
      description:
        plansError ?? "Setlist failed to load plan summaries.",
    };
  }
  if (!beatsOk) {
    return {
      title: "Couldn’t load beat details",
      description:
        beatsError ?? "Setlist failed to load repo beats.",
    };
  }
  if (planCount === 0) {
    return {
      title: "No execution plans yet",
      description:
        "Create an execution plan for this repository and"
        + " it will show up here as a selectable setlist.",
    };
  }
  return null;
}

function LoadedSetlistView({
  repoPath,
  planSummaries,
  previews,
  selectedPlanId,
  selectedWorkableBeatCount,
  onSelectPlan,
  planQuery,
  selectedPlanRecord,
  chart,
}: {
  repoPath: string | undefined;
  planSummaries: PlanSummary[];
  previews: Map<string, ReturnType<typeof buildSetlistPlanPreview>>;
  selectedPlanId: string | null;
  selectedWorkableBeatCount: number | null;
  onSelectPlan: (planId: string) => void;
  planQuery: UseQueryResult<BdResult<PlanRecord>>;
  selectedPlanRecord: PlanRecord | null;
  chart: ReturnType<typeof buildSetlistChart> | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SetlistSummaryPanel
        planSummaries={planSummaries}
        previews={previews}
        selectedPlanId={selectedPlanId}
        selectedWorkableBeatCount={selectedWorkableBeatCount}
        onSelectPlan={onSelectPlan}
      />

      <div>
        {planQuery.isLoading && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading selected execution plan...
          </div>
        )}
        {!planQuery.isLoading && !planQuery.data?.ok && (
          <div className="flex flex-1 items-center justify-center text-sm text-destructive">
            {planQuery.data?.error ?? "Failed to load the selected plan."}
          </div>
        )}
        {chart && selectedPlanRecord && (
          <SetlistChartPanel
            chart={chart}
            repoPath={repoPath}
          />
        )}
      </div>
    </div>
  );
}

function SetlistSummaryPanel({
  planSummaries,
  previews,
  selectedPlanId,
  selectedWorkableBeatCount,
  onSelectPlan,
}: {
  planSummaries: PlanSummary[];
  previews: Map<string, ReturnType<typeof buildSetlistPlanPreview>>;
  selectedPlanId: string | null;
  selectedWorkableBeatCount: number | null;
  onSelectPlan: (planId: string) => void;
}) {
  return (
    <Card className="gap-[5px] border-border/70 shadow-sm">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ListMusic className="size-4" />
            Setlist
          </h2>
          <Badge variant="outline" className="h-7 px-3 text-xs">
            {planSummaries.length} plan{planSummaries.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {planSummaries.map((plan) => (
            <PlanSummaryCard
              key={plan.artifact.id}
              plan={plan}
              preview={previews.get(plan.artifact.id)!}
              selected={plan.artifact.id === selectedPlanId}
              selectedWorkableBeatCount={
                plan.artifact.id === selectedPlanId
                  ? selectedWorkableBeatCount
                  : null
              }
              onSelect={onSelectPlan}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function useSetlistBaseData(repoPath?: string) {
  const plansQuery = useQuery({
    queryKey: ["setlist-plans", repoPath],
    queryFn: () => fetchPlanSummaries(repoPath!),
    enabled: Boolean(repoPath),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const beatsQuery = useQuery({
    queryKey: ["setlist-beats", repoPath],
    queryFn: () => fetchRepoBeats(repoPath!),
    enabled: Boolean(repoPath),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const planSummaries = useMemo(
    () => (plansQuery.data?.ok ? plansQuery.data.data ?? [] : []),
    [plansQuery.data],
  );
  const repoBeats = useMemo(
    () => (beatsQuery.data?.ok ? beatsQuery.data.data ?? [] : []),
    [beatsQuery.data],
  );
  const beatMap = useMemo(
    () => {
      const map = new Map<string, Beat>();
      for (const beat of repoBeats) {
        indexBeat(map, beat);
      }
      return map;
    },
    [repoBeats],
  );
  const previews = useMemo(
    () => new Map(planSummaries.map((plan) => [
      plan.artifact.id,
      buildSetlistPlanPreview(plan, beatMap),
    ])),
    [beatMap, planSummaries],
  );

  return {
    plansQuery,
    beatsQuery,
    planSummaries,
    repoBeats,
    previews,
    summaryBeatMap: beatMap,
  };
}

function resolveSelectedPlanId(
  requestedPlanId: string | null,
  planSummaries: PlanSummary[],
): string | null {
  if (!requestedPlanId) {
    return planSummaries[0]?.artifact.id ?? null;
  }
  return planSummaries.some(
    (plan) => plan.artifact.id === requestedPlanId,
  )
    ? requestedPlanId
    : planSummaries[0]?.artifact.id ?? null;
}

function useSelectedPlanData(
  repoPath: string | undefined,
  selectedPlanId: string | null,
  beatMap: ReadonlyMap<string, Beat>,
) {
  const planQuery = useQuery({
    queryKey: ["setlist-plan", repoPath, selectedPlanId],
    queryFn: () => fetchPlan(selectedPlanId!, repoPath!),
    enabled: Boolean(repoPath && selectedPlanId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const selectedPlanRecord = planQuery.data?.ok
    ? (planQuery.data.data ?? null)
    : null;
  const missingBeatIds = useMemo(
    () => selectedPlanRecord
      ? Array.from(
          new Set(
            selectedPlanRecord.plan.beatIds.filter(
              (beatId) => !beatMap.has(beatId),
            ),
          ),
        )
      : [],
    [beatMap, selectedPlanRecord],
  );
  const missingBeatQueries = useQueries({
    queries: missingBeatIds.map((beatId) => ({
      queryKey: ["setlist-plan-beat", repoPath, beatId],
      queryFn: () => fetchBeat(beatId, repoPath),
      enabled: Boolean(repoPath && selectedPlanRecord),
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
  });
  const chartBeatMap = useMemo(() => {
    const map = new Map(beatMap);
    missingBeatIds.forEach((beatId, index) => {
      const result = missingBeatQueries[index]?.data;
      if (!result?.ok || !result.data) {
        return;
      }
      indexBeat(map, result.data, beatId);
    });
    return map;
  }, [beatMap, missingBeatIds, missingBeatQueries]);
  const chart = useMemo(
    () => selectedPlanRecord
      ? buildSetlistChart(
          selectedPlanRecord.plan,
          chartBeatMap,
        )
      : null,
    [chartBeatMap, selectedPlanRecord],
  );

  return { planQuery, selectedPlanRecord, chart };
}

function indexBeat(
  map: Map<string, Beat>,
  beat: Beat,
  requestedId?: string,
): void {
  if (requestedId) {
    map.set(requestedId, beat);
  }
  map.set(beat.id, beat);
  for (const alias of beat.aliases ?? []) {
    map.set(alias, beat);
  }
}

function PlanSummaryCard({
  plan,
  preview,
  selected,
  selectedWorkableBeatCount,
  onSelect,
}: {
  plan: PlanSummary;
  preview: ReturnType<typeof buildSetlistPlanPreview>;
  selected: boolean;
  selectedWorkableBeatCount: number | null;
  onSelect: (planId: string) => void;
}) {
  const beatCount = selectedWorkableBeatCount ?? preview.totalBeats;
  const beatCountLabel = selectedWorkableBeatCount !== null
    ? "remaining"
    : "beats";

  return (
    <button
      type="button"
      className={cn(
        "flex h-full flex-col rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary/35 bg-primary/[0.03] shadow-sm"
          : "border-border/70 bg-card hover:border-primary/40 hover:bg-accent/30",
      )}
      onClick={() => onSelect(plan.artifact.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant={selected ? "default" : "outline"}>
          {selected ? "Selected" : "Execution plan"}
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground">
          {plan.artifact.id}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <div>
          <p className="text-base font-semibold leading-tight">
            {preview.summary}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {preview.objective ?? "No objective captured."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
            <Music4 className="size-3.5" />
            {beatCount} {beatCountLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
            <GitBranch className="size-3.5" />
            {plan.plan.mode ?? "groom"}
          </span>
        </div>

        {!selected && (
          <div className="space-y-2 pt-1">
            {preview.previewBeats.map((beat) => (
              <div
                key={beat.id}
                className="rounded-lg border border-border/60 bg-background/80 px-3 py-2"
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {beat.label}
                </span>
                {beat.title ? (
                  <p className="text-sm font-medium leading-tight">
                    {beat.title}
                  </p>
                ) : null}
              </div>
            ))}
            {preview.remainingBeats > 0 && (
              <p className="text-xs text-muted-foreground">
                +{preview.remainingBeats} more beat
                {preview.remainingBeats === 1 ? "" : "s"}
              </p>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function EmptySetlistState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent
        className={
          "flex min-h-[22rem] flex-col items-center"
          + " justify-center gap-3 text-center"
        }
      >
        <Button variant="outline" size="icon" className="pointer-events-none size-11 rounded-full">
          <ListMusic className="size-5" />
        </Button>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {title}
          </h2>
          <p className="max-w-lg text-sm text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
