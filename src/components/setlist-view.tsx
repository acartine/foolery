"use client";

import { useMemo, useState } from "react";
import {
  type UseQueryResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ListMusic } from "lucide-react";
import { toast } from "sonner";
import { PlanSummaryCard } from "@/components/plan-summary-card";
import { SetlistChartPanel } from "@/components/setlist-chart-panel";
import {
  EmptySetlistState,
  getEmptySetlistState,
} from "@/components/setlist-empty-state";
import {
  resolveSelectedPlanId,
  useSelectedPlanData,
  useSetlistBaseData,
} from "@/components/setlist-view-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { completePlan as requestCompletePlan } from "@/lib/plan-api";
import {
  buildSetlistChart,
  buildSetlistPlanPreview,
  isTerminalPlanArtifactState,
} from "@/lib/setlist-chart";
import type { PlanRecord, PlanSummary } from "@/lib/orchestration-plan-types";
import type { BdResult } from "@/lib/types";

export function SetlistView({
  repoPath,
  activeBeatIds,
}: {
  repoPath?: string;
  activeBeatIds?: ReadonlySet<string>;
}) {
  const [requestedPlanId, setRequestedPlanId] = useState<string | null>(null);
  const {
    plansQuery,
    beatsQuery,
    planSummaries,
    previews,
    summaryBeatMap,
    workableBeatCountByPlan,
  } = useSetlistBaseData(repoPath);
  const selectedPlanId = useMemo(
    () => resolveSelectedPlanId(requestedPlanId, planSummaries),
    [planSummaries, requestedPlanId],
  );
  const { planQuery, selectedPlanRecord, chart } = useSelectedPlanData(
    repoPath,
    selectedPlanId,
    summaryBeatMap,
    activeBeatIds,
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
      workableBeatCountByPlan={workableBeatCountByPlan}
      onSelectPlan={setRequestedPlanId}
      planQuery={planQuery}
      selectedPlanRecord={selectedPlanRecord}
      chart={chart}
    />
  );
}

function LoadedSetlistView({
  repoPath,
  planSummaries,
  previews,
  selectedPlanId,
  workableBeatCountByPlan,
  onSelectPlan,
  planQuery,
  selectedPlanRecord,
  chart,
}: {
  repoPath: string | undefined;
  planSummaries: PlanSummary[];
  previews: Map<string, ReturnType<typeof buildSetlistPlanPreview>>;
  selectedPlanId: string | null;
  workableBeatCountByPlan: ReadonlyMap<string, number>;
  onSelectPlan: (planId: string) => void;
  planQuery: UseQueryResult<BdResult<PlanRecord>>;
  selectedPlanRecord: PlanRecord | null;
  chart: ReturnType<typeof buildSetlistChart> | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SetlistSummaryPanel
        repoPath={repoPath}
        planSummaries={planSummaries}
        previews={previews}
        selectedPlanId={selectedPlanId}
        workableBeatCountByPlan={workableBeatCountByPlan}
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
  repoPath,
  planSummaries,
  previews,
  selectedPlanId,
  workableBeatCountByPlan,
  onSelectPlan,
}: {
  repoPath: string | undefined;
  planSummaries: PlanSummary[];
  previews: Map<string, ReturnType<typeof buildSetlistPlanPreview>>;
  selectedPlanId: string | null;
  workableBeatCountByPlan: ReadonlyMap<string, number>;
  onSelectPlan: (planId: string) => void;
}) {
  const queryClient = useQueryClient();
  const completeMutation = useMutation({
    mutationFn: async (planId: string) => {
      if (!repoPath) {
        throw new Error("Cannot complete a plan without a repoPath.");
      }
      const result = await requestCompletePlan(planId, repoPath);
      if (!result.ok) {
        throw new Error(result.error ?? "Failed to complete plan.");
      }
      return { planId, plan: result.data };
    },
    onSuccess: ({ planId }) => {
      toast.success("Plan completed");
      void queryClient.invalidateQueries({
        queryKey: ["setlist-plans", repoPath],
      });
      void queryClient.invalidateQueries({
        queryKey: ["setlist-plan", repoPath, planId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
  const pendingPlanId = completeMutation.isPending
    ? completeMutation.variables ?? null
    : null;

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
          {planSummaries.map((plan) => {
            const workableBeatCount =
              workableBeatCountByPlan.get(plan.artifact.id) ?? 0;
            const canComplete =
              workableBeatCount === 0 &&
              !isTerminalPlanArtifactState(plan.artifact.state);
            return (
              <PlanSummaryCard
                key={plan.artifact.id}
                plan={plan}
                preview={previews.get(plan.artifact.id)!}
                selected={plan.artifact.id === selectedPlanId}
                workableBeatCount={workableBeatCount}
                canComplete={canComplete}
                isCompleting={pendingPlanId === plan.artifact.id}
                onSelect={onSelectPlan}
                onComplete={(planId) => completeMutation.mutate(planId)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
