import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import {
  buildBeatsQueryKey,
  fetchBeat,
  fetchBeatsForScope,
} from "@/lib/api";
import { fetchPlan, fetchPlanSummaries } from "@/lib/plan-api";
import {
  buildSetlistChart,
  buildSetlistPlanPreview,
  countWorkableBeatIds,
} from "@/lib/setlist-chart";
import type { PlanSummary } from "@/lib/orchestration-plan-types";
import type { Beat } from "@/lib/types";

export function useSetlistBaseData(repoPath?: string) {
  const repoScope = useMemo(
    () =>
      repoPath
        ? {
          kind: "repo" as const,
          key: `repo:${repoPath}`,
          repo: repoPath,
        }
        : null,
    [repoPath],
  );
  const plansQuery = useQuery({
    queryKey: ["setlist-plans", repoPath],
    queryFn: () => fetchPlanSummaries(repoPath!),
    enabled: Boolean(repoPath),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const beatsQuery = useQuery({
    queryKey: repoScope
      ? buildBeatsQueryKey("setlist", {}, repoScope)
      : ["beats", "setlist", "repo:none", "{}"],
    queryFn: () => fetchBeatsForScope({}, repoScope!, []),
    enabled: Boolean(repoScope),
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
  const planMissingBeatIds = useMemo(
    () => collectMissingBeatIds(planSummaries, beatMap),
    [beatMap, planSummaries],
  );
  const planBeatQueries = useQueries({
    queries: planMissingBeatIds.map((beatId) => ({
      queryKey: ["setlist-plan-beat", repoPath, beatId],
      queryFn: () => fetchBeat(beatId, repoPath),
      enabled: Boolean(repoPath),
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
  });
  const enrichedBeatMap = useMemo(() => {
    if (planMissingBeatIds.length === 0) return beatMap;
    const map = new Map(beatMap);
    planMissingBeatIds.forEach((beatId, index) => {
      const result = planBeatQueries[index]?.data;
      if (!result?.ok || !result.data) return;
      indexBeat(map, result.data, beatId);
    });
    return map;
  }, [beatMap, planBeatQueries, planMissingBeatIds]);
  const workableBeatCountByPlan = useMemo(
    () => new Map(planSummaries.map((plan) => [
      plan.artifact.id,
      countWorkableBeatIds(plan.plan.beatIds, enrichedBeatMap),
    ])),
    [enrichedBeatMap, planSummaries],
  );

  return {
    plansQuery,
    beatsQuery,
    planSummaries,
    repoBeats,
    previews,
    summaryBeatMap: enrichedBeatMap,
    workableBeatCountByPlan,
  };
}

function collectMissingBeatIds(
  planSummaries: PlanSummary[],
  beatMap: ReadonlyMap<string, Beat>,
): string[] {
  const missing = new Set<string>();
  for (const plan of planSummaries) {
    for (const beatId of plan.plan.beatIds) {
      if (!beatId || beatMap.has(beatId)) continue;
      missing.add(beatId);
    }
  }
  return Array.from(missing);
}

export function resolveSelectedPlanId(
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

export function useSelectedPlanData(
  repoPath: string | undefined,
  selectedPlanId: string | null,
  beatMap: ReadonlyMap<string, Beat>,
  activeBeatIds: ReadonlySet<string> | undefined,
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
          { activeBeatIds },
        )
      : null,
    [activeBeatIds, chartBeatMap, selectedPlanRecord],
  );

  return { planQuery, selectedPlanRecord, chart };
}

export function indexBeat(
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
