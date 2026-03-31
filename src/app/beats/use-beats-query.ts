import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
} from "@/lib/api";
import { withClientPerfSpan } from "@/lib/client-perf";
import { useAppStore } from "@/stores/app-store";
import {
  hasRollingAncestor as hasRollingAncestorLib,
} from "@/lib/rolling-ancestor";
import type { Beat, RegisteredRepo } from "@/lib/types";

const DEGRADED_ERROR_PREFIX =
  "Unable to interact with beats store";

class DegradedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DegradedStoreError";
  }
}

function throwIfDegraded(
  result: { ok: boolean; error?: string },
): void {
  if (
    !result.ok
    && result.error?.startsWith(DEGRADED_ERROR_PREFIX)
  ) {
    throw new DegradedStoreError(result.error);
  }
}

interface UseBeatsQueryArgs {
  beatsView: string;
  searchQuery: string;
  isListView: boolean;
  activeRepo: string | null;
  registeredRepos: RegisteredRepo[];
  shippingByBeatId: Record<string, string>;
}

export interface UseBeatsQueryResult {
  beats: Beat[];
  isLoading: boolean;
  loadError: string | null;
  isDegradedError: boolean;
  hasRollingAncestor: (
    beat: Pick<Beat, "id" | "parent">,
  ) => boolean;
}

export function useBeatsQuery(
  args: UseBeatsQueryArgs,
): UseBeatsQueryResult {
  const {
    beatsView, searchQuery, isListView, activeRepo,
    registeredRepos, shippingByBeatId,
  } = args;
  const { filters } = useAppStore();
  const scope = resolveBeatsScope(activeRepo, registeredRepos);

  const params: Record<string, string> = {};
  if (!searchQuery && filters.state) {
    params.state = filters.state;
  }
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) {
    params.priority = String(filters.priority);
  }
  if (searchQuery) params.q = searchQuery;

  const {
    data, isLoading, error: queryError,
  } = useQuery({
    queryKey: buildBeatsQueryKey(beatsView, params, scope),
    queryFn: async () => {
      const result = await withClientPerfSpan(
        "query",
        "beats:list",
        () => fetchBeatsForScope(params, scope, registeredRepos),
        () => ({ meta: { beatsView, params, scope: scope.key } }),
      );
      throwIfDegraded(result);
      return result;
    },
    enabled: isListView && (
      Boolean(activeRepo) || registeredRepos.length > 0
    ),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: (count, error) =>
      !(error instanceof DegradedStoreError)
      && count < 3,
  });

  const beats = useMemo<Beat[]>(
    () => (data?.ok ? (data.data ?? []) : []),
    [data],
  );

  const parentByBeatId = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const beat of beats) {
      map.set(beat.id, beat.parent);
    }
    return map;
  }, [beats]);

  const hasRollingAncestor = useCallback(
    (beat: Pick<Beat, "id" | "parent">): boolean =>
      hasRollingAncestorLib(
        beat, parentByBeatId, shippingByBeatId,
      ),
    [parentByBeatId, shippingByBeatId],
  );

  const partialDegradedMsg = data?.ok
    ? (data as { _degraded?: string })._degraded
    : undefined;

  const isDegradedError =
    queryError instanceof DegradedStoreError
    || Boolean(partialDegradedMsg);

  const loadError = deriveLoadError(
    queryError, partialDegradedMsg, data,
  );

  return {
    beats, isLoading, loadError,
    isDegradedError, hasRollingAncestor,
  };
}

function deriveLoadError(
  queryError: Error | null,
  partialDegradedMsg: string | undefined,
  data: { ok: boolean; error?: string } | undefined,
): string | null {
  if (queryError instanceof DegradedStoreError) {
    return queryError.message;
  }
  if (partialDegradedMsg) return partialDegradedMsg;
  if (data && !data.ok) {
    return data.error ?? "Failed to load beats.";
  }
  return null;
}
