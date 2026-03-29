"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
  serializeQueryParams,
} from "@/lib/api";
import { useAppStore, type Filters } from "@/stores/app-store";

type BeatsWarmView =
  | "queues"
  | "active"
  | "finalcut"
  | "retakes";

const HUMAN_ACTION_PARAMS: Record<string, string> = {
  requiresHumanAction: "true",
};

function buildListParams(
  view: "queues" | "active",
  filters: Filters,
): Record<string, string> {
  const params: Record<string, string> = {
    state: view === "active" ? "in_action" : "queued",
  };
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) {
    params.priority = String(filters.priority);
  }
  return params;
}

function buildWarmTargets(
  currentView: BeatsWarmView,
  filters: Filters,
): Array<{
  view: BeatsWarmView;
  params: Record<string, string>;
}> {
  const targets: Array<{
    view: BeatsWarmView;
    params: Record<string, string>;
  }> = [];

  if (currentView !== "queues") {
    targets.push({
      view: "queues",
      params: buildListParams("queues", filters),
    });
  }
  if (currentView !== "active") {
    targets.push({
      view: "active",
      params: buildListParams("active", filters),
    });
  }
  if (currentView !== "finalcut") {
    targets.push({
      view: "finalcut",
      params: HUMAN_ACTION_PARAMS,
    });
  }
  if (currentView !== "retakes") {
    targets.push({ view: "retakes", params: {} });
  }

  return targets;
}

export function useBeatsScreenWarmup(
  currentView: BeatsWarmView | null,
  ready: boolean,
): void {
  const queryClient = useQueryClient();
  const { activeRepo, registeredRepos, filters } = useAppStore();
  const scope = resolveBeatsScope(activeRepo, registeredRepos);
  const warmedKeyRef = useRef<string | null>(null);

  const targets = useMemo(
    () => currentView
      ? buildWarmTargets(currentView, filters)
      : [],
    [currentView, filters],
  );

  const targetKey = useMemo(
    () => targets
      .map((target) =>
        `${target.view}:${serializeQueryParams(target.params)}`)
      .join("|"),
    [targets],
  );

  useEffect(() => {
    if (!ready) return;
    if (!currentView) return;
    if (!activeRepo && registeredRepos.length === 0) return;

    const warmKey = `${currentView}:${scope.key}:${targetKey}`;
    if (warmedKeyRef.current === warmKey) return;
    warmedKeyRef.current = warmKey;

    const timerId = window.setTimeout(() => {
      for (const target of targets) {
        void queryClient.prefetchQuery({
          queryKey: buildBeatsQueryKey(
            target.view,
            target.params,
            scope,
          ),
          queryFn: () => fetchBeatsForScope(
            target.params,
            scope,
            registeredRepos,
          ),
          staleTime: 30_000,
        });
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [
    activeRepo,
    currentView,
    queryClient,
    ready,
    registeredRepos,
    scope,
    targetKey,
    targets,
  ]);
}
