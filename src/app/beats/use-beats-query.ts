import { useMemo, useCallback } from "react";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  fetchBeatsForScopeStreaming,
  resolveBeatsScope,
} from "@/lib/api";
import type { BeatsScope } from "@/lib/api";
import type { BdResult } from "@/lib/types";
import { withClientPerfSpan } from "@/lib/client-perf";
import { useAppStore } from "@/stores/app-store";
import { useRepoSwitchQueryState } from "@/hooks/use-repo-switch-query-state";
import {
  hasRollingAncestor as hasRollingAncestorLib,
} from "@/lib/rolling-ancestor";
import type { Beat, RegisteredRepo } from "@/lib/types";
import {
  useStreamingProgress,
} from "./use-streaming-progress";
import type {
  StreamingProgress,
} from "./use-streaming-progress";

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

export type { StreamingProgress };

export interface UseBeatsQueryResult {
  beats: Beat[];
  isLoading: boolean;
  loadError: string | null;
  isDegradedError: boolean;
  hasRollingAncestor: (
    beat: Pick<Beat, "id" | "parent">,
  ) => boolean;
  streamingProgress: StreamingProgress;
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
  const streaming = useStreamingProgress();

  const params: Record<string, string> = {};
  if (!searchQuery && filters.state) {
    params.state = filters.state;
  }
  if (filters.type) params.type = filters.type;
  if (filters.priority !== undefined) {
    params.priority = String(filters.priority);
  }
  if (searchQuery) params.q = searchQuery;

  const queryClient = useQueryClient();
  const queryKey = buildBeatsQueryKey(
    beatsView, params, scope,
  );

  const {
    data, isLoading, isFetched,
    fetchStatus, error: queryError,
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchBeatsWithStreaming({
      params, scope, registeredRepos,
      beatsView, signal, queryKey,
      setQueryData: (updater) =>
        queryClient.setQueryData(queryKey, updater),
      onStreamStart: streaming.onStreamStart,
      onRepoLoaded: streaming.onRepoLoaded,
      onStreamComplete: streaming.onStreamComplete,
    }),
    enabled: isListView && (
      Boolean(activeRepo) || registeredRepos.length > 0
    ),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: (count, error) =>
      !(error instanceof DegradedStoreError)
      && count < 3,
  });
  const display = useRepoSwitchQueryState(scope.key, {
    data,
    error: queryError,
    fetchStatus,
    isFetched,
    isLoading,
  });

  const beats = useMemo<Beat[]>(
    () => (display.data?.ok
      ? (display.data.data ?? [])
      : []),
    [display.data],
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

  const partialDegradedMsg = display.data?.ok
    ? (display.data as { _degraded?: string })._degraded
    : undefined;

  const isDegradedError =
    queryError instanceof DegradedStoreError
    || Boolean(partialDegradedMsg);

  const loadError = deriveLoadError(
    queryError, partialDegradedMsg, display.data,
  );

  return {
    beats, isLoading: display.isLoading, loadError,
    isDegradedError, hasRollingAncestor,
    streamingProgress: streaming.progress,
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

type QueryData = BdResult<Beat[]> & { _degraded?: string };
type SetQueryData = (
  updater: (old: QueryData | undefined) => QueryData,
) => void;

interface StreamingFetchArgs {
  params: Record<string, string>;
  scope: BeatsScope;
  registeredRepos: RegisteredRepo[];
  beatsView: string;
  signal: AbortSignal;
  queryKey: readonly unknown[];
  setQueryData: SetQueryData;
  onStreamStart: (total: number) => void;
  onRepoLoaded: (repo: string) => void;
  onStreamComplete: () => void;
}

/**
 * For `scope=all`, use NDJSON streaming to show per-repo
 * results incrementally.  For other scopes, fall back to
 * the standard non-streaming fetch.
 */
async function fetchBeatsWithStreaming(
  args: StreamingFetchArgs,
): Promise<QueryData> {
  const {
    params, scope, registeredRepos,
    beatsView, signal, setQueryData,
    onStreamStart, onRepoLoaded, onStreamComplete,
  } = args;

  if (scope.kind !== "all") {
    const result = await withClientPerfSpan(
      "query", "beats:list",
      () => fetchBeatsForScope(
        params, scope, registeredRepos,
      ),
      () => ({
        meta: { beatsView, params, scope: scope.key },
      }),
    );
    throwIfDegraded(result);
    return result;
  }

  onStreamStart(registeredRepos.length);

  const result = await withClientPerfSpan(
    "query", "beats:list-stream",
    () => fetchBeatsForScopeStreaming(params, scope, {
      signal,
      onRepoChunk: (repo, _repoName, beats) => {
        setQueryData((old) => {
          const prev = old?.ok ? (old.data ?? []) : [];
          return {
            ok: true,
            data: [...prev, ...beats],
          };
        });
        onRepoLoaded(repo);
      },
    }),
    () => ({
      meta: { beatsView, params, scope: scope.key },
    }),
  );
  onStreamComplete();
  throwIfDegraded(result);
  return result;
}
