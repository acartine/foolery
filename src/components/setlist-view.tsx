"use client";

import {
  useMemo,
  useState,
} from "react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import {
  GitBranch,
  ListMusic,
  MapPinned,
  Music4,
} from "lucide-react";
import { SetlistChartPanel } from "@/components/setlist-chart-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPlan, fetchPlanSummaries, fetchRepoBeats } from "@/lib/plan-api";
import { buildSetlistChart, buildSetlistPlanPreview } from "@/lib/setlist-chart";
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
    repoBeats,
    previews,
    beatMap,
  } = useSetlistBaseData(repoPath);
  const selectedPlanId = useMemo(
    () => resolveSelectedPlanId(requestedPlanId, planSummaries),
    [planSummaries, requestedPlanId],
  );
  const selectedPlan = useMemo(
    () => planSummaries.find(
      (plan) => plan.artifact.id === selectedPlanId,
    ),
    [planSummaries, selectedPlanId],
  );
  const { planQuery, selectedPlanRecord, chart } = useSelectedPlanData(
    repoPath,
    selectedPlanId,
    beatMap,
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
      planSummaries={planSummaries}
      previews={previews}
      selectedPlan={selectedPlan}
      selectedPlanId={selectedPlanId}
      onSelectPlan={setRequestedPlanId}
      planQuery={planQuery}
      selectedPlanRecord={selectedPlanRecord}
      chart={chart}
      repoBeats={repoBeats}
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
  planSummaries,
  previews,
  selectedPlan,
  selectedPlanId,
  onSelectPlan,
  planQuery,
  selectedPlanRecord,
  chart,
  repoBeats,
}: {
  planSummaries: PlanSummary[];
  previews: Map<string, ReturnType<typeof buildSetlistPlanPreview>>;
  selectedPlan: PlanSummary | undefined;
  selectedPlanId: string | null;
  onSelectPlan: (planId: string) => void;
  planQuery: UseQueryResult<BdResult<PlanRecord>>;
  selectedPlanRecord: PlanRecord | null;
  chart: ReturnType<typeof buildSetlistChart> | null;
  repoBeats: Beat[];
}) {
  return (
    <div className="flex min-h-[72vh] flex-col gap-4">
      <SetlistSummaryPanel
        planSummaries={planSummaries}
        previews={previews}
        selectedPlanId={selectedPlanId}
        onSelectPlan={onSelectPlan}
      />

      <Card className="flex min-h-[30rem] flex-1 flex-col border-border/70 shadow-sm">
        <CardHeader className="gap-3 border-b border-border/60">
          <SelectedPlanHeader
            selectedPlan={selectedPlan}
            chart={chart}
          />
        </CardHeader>
        <CardContent className="flex flex-1 flex-col p-4">
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
              beats={repoBeats}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SetlistSummaryPanel({
  planSummaries,
  previews,
  selectedPlanId,
  onSelectPlan,
}: {
  planSummaries: PlanSummary[];
  previews: Map<string, ReturnType<typeof buildSetlistPlanPreview>>;
  selectedPlanId: string | null;
  onSelectPlan: (planId: string) => void;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ListMusic className="size-4" />
              Setlist
            </div>
            <CardTitle className="text-xl">
              Execution-plan overview
            </CardTitle>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Browse persisted execution plans, scan the beats they include,
              and open one plan at a time as a slot-based gantt chart.
            </p>
          </div>
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
    () => new Map(repoBeats.map((beat) => [beat.id, beat])),
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
    beatMap,
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
  const chart = useMemo(
    () => selectedPlanRecord
      ? buildSetlistChart(selectedPlanRecord.plan, beatMap)
      : null,
    [beatMap, selectedPlanRecord],
  );

  return { planQuery, selectedPlanRecord, chart };
}

function PlanSummaryCard({
  plan,
  preview,
  selected,
  onSelect,
}: {
  plan: PlanSummary;
  preview: ReturnType<typeof buildSetlistPlanPreview>;
  selected: boolean;
  onSelect: (planId: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-full flex-col rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
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
            {preview.totalBeats} beats
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
            <GitBranch className="size-3.5" />
            {plan.plan.mode ?? "groom"}
          </span>
        </div>

        <div className="space-y-2 pt-1">
          {preview.previewBeats.map((beat) => (
            <div
              key={beat.id}
              className="rounded-lg border border-border/60 bg-background/80 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {beat.label}
                </span>
              </div>
              <p className="text-sm font-medium leading-tight">
                {beat.title}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {beat.description ?? "No description yet."}
              </p>
            </div>
          ))}
          {preview.remainingBeats > 0 && (
            <p className="text-xs text-muted-foreground">
              +{preview.remainingBeats} more beat
              {preview.remainingBeats === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function SelectedPlanHeader({
  selectedPlan,
  chart,
}: {
  selectedPlan: PlanSummary | undefined;
  chart: ReturnType<typeof buildSetlistChart> | null;
}) {
  if (!selectedPlan) {
    return (
      <div className="text-sm text-muted-foreground">
        Pick an execution plan to render its setlist.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPinned className="size-4" />
          Selected plan
        </div>
        <h2 className="text-xl font-semibold">
          {selectedPlan.plan.summary}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {selectedPlan.plan.objective ?? "No objective captured."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="h-7 px-3 text-xs">
          {chart?.slots.length ?? 0} slots
        </Badge>
        <Badge variant="outline" className="h-7 px-3 text-xs">
          {selectedPlan.plan.beatIds.length} beats
        </Badge>
      </div>
    </div>
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
