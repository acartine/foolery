import {
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchBeat } from "@/lib/api";
import type {
  AgentHistoryBeatSummary,
} from "@/lib/agent-history-types";
import type { Beat } from "@/lib/types";
import {
  beatKey,
  CACHE_MAX,
  parseBeatKey,
  WINDOW_SIZE,
} from "@/components/agent-history-utils";

interface BeatDetailQueriesInput {
  visibleBeats: AgentHistoryBeatSummary[];
  focusedBeatKey: string | null;
  loadedBeatKey: string | null;
  windowStart: number;
  beats: AgentHistoryBeatSummary[];
  lastScrollDirectionRef: React.MutableRefObject<
    1 | -1
  >;
}

export function useBeatDetailQueries(
  input: BeatDetailQueriesInput,
) {
  const {
    visibleBeats,
    focusedBeatKey,
    loadedBeatKey,
    windowStart,
    beats,
    lastScrollDirectionRef,
  } = input;
  const queryClient = useQueryClient();

  const loadedBeat = useMemo(
    () => parseBeatKey(loadedBeatKey),
    [loadedBeatKey],
  );

  const detailQueries = useQueries({
    queries: visibleBeats.map((beat) => ({
      queryKey: [
        "agent-history-beat-detail",
        beat.repoPath,
        beat.beatId,
      ] as const,
      queryFn: () =>
        fetchBeat(beat.beatId, beat.repoPath),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  const beatDetailMap = useMemo(
    () => buildDetailMap(detailQueries, visibleBeats),
    [detailQueries, visibleBeats],
  );

  const loadedDetailQuery = useQuery({
    queryKey: [
      "agent-history-beat-detail",
      loadedBeat?.repoPath ?? null,
      loadedBeat?.beatId ?? null,
    ],
    queryFn: () =>
      fetchBeat(
        loadedBeat!.beatId,
        loadedBeat!.repoPath,
      ),
    enabled: Boolean(loadedBeat),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const loadedDetail = useMemo(
    () =>
      loadedDetailQuery.data?.ok
        ? (loadedDetailQuery.data.data ?? null)
        : null,
    [loadedDetailQuery.data],
  );

  const focusedDetail = useMemo(
    () =>
      deriveFocusedDetail(
        focusedBeatKey,
        visibleBeats,
        detailQueries,
      ),
    [focusedBeatKey, visibleBeats, detailQueries],
  );

  usePrefetchNextBatch(
    focusedBeatKey,
    visibleBeats,
    windowStart,
    beats,
    queryClient,
  );

  useCacheEviction(
    visibleBeats,
    queryClient,
    lastScrollDirectionRef,
  );

  return {
    loadedBeat,
    beatDetailMap,
    loadedDetail,
    focusedDetail,
  };
}

function buildDetailMap(
  detailQueries: Array<{
    data?: { ok: boolean; data?: Beat };
  }>,
  visibleBeats: AgentHistoryBeatSummary[],
): Map<string, Beat> {
  const map = new Map<string, Beat>();
  for (let i = 0; i < detailQueries.length; i++) {
    const q = detailQueries[i];
    const beat = visibleBeats[i];
    if (q?.data?.ok && q.data.data && beat) {
      map.set(
        beatKey(beat.beatId, beat.repoPath),
        q.data.data,
      );
    }
  }
  return map;
}

function deriveFocusedDetail(
  focusedBeatKey: string | null,
  visibleBeats: AgentHistoryBeatSummary[],
  detailQueries: Array<{
    isLoading: boolean;
    data?: {
      ok: boolean;
      data?: Beat;
      error?: string;
    };
  }>,
) {
  if (!focusedBeatKey) {
    return {
      loading: false,
      error: null as string | null,
      beat: null as Beat | null,
    };
  }
  const idx = visibleBeats.findIndex(
    (b) =>
      beatKey(b.beatId, b.repoPath)
      === focusedBeatKey,
  );
  if (idx < 0) {
    return {
      loading: false,
      error: null,
      beat: null,
    };
  }
  const q = detailQueries[idx];
  if (q.isLoading) {
    return {
      loading: true,
      error: null,
      beat: null,
    };
  }
  if (q.data && !q.data.ok) {
    return {
      loading: false,
      error: q.data.error ?? "Failed to load",
      beat: null,
    };
  }
  return {
    loading: false,
    error: null,
    beat: q.data?.data ?? null,
  };
}

function usePrefetchNextBatch(
  focusedBeatKey: string | null,
  visibleBeats: AgentHistoryBeatSummary[],
  windowStart: number,
  beats: AgentHistoryBeatSummary[],
  queryClient: ReturnType<typeof useQueryClient>,
) {
  useEffect(() => {
    const focusIdx = focusedBeatKey
      ? visibleBeats.findIndex(
        (b) =>
          beatKey(b.beatId, b.repoPath)
          === focusedBeatKey,
      )
      : -1;
    if (focusIdx < Math.floor(WINDOW_SIZE / 2)) {
      return;
    }

    const start = windowStart + WINDOW_SIZE;
    const end = Math.min(
      beats.length,
      start + WINDOW_SIZE,
    );
    for (let i = start; i < end; i++) {
      const beat = beats[i];
      void queryClient.prefetchQuery({
        queryKey: [
          "agent-history-beat-detail",
          beat.repoPath,
          beat.beatId,
        ],
        queryFn: () =>
          fetchBeat(
            beat.beatId,
            beat.repoPath,
          ),
        staleTime: 60_000,
      });
    }
  }, [
    windowStart,
    focusedBeatKey,
    beats,
    visibleBeats,
    queryClient,
  ]);
}

function useCacheEviction(
  visibleBeats: AgentHistoryBeatSummary[],
  queryClient: ReturnType<typeof useQueryClient>,
  lastScrollDirectionRef: React.MutableRefObject<
    1 | -1
  >,
) {
  const cachedRef = useRef<string[]>([]);
  useEffect(() => {
    const cached = cachedRef.current;
    for (const beat of visibleBeats) {
      const key = beatKey(
        beat.beatId,
        beat.repoPath,
      );
      const idx = cached.indexOf(key);
      if (idx >= 0) cached.splice(idx, 1);
      cached.push(key);
    }
    while (cached.length > CACHE_MAX) {
      const dir =
        lastScrollDirectionRef.current;
      const evicted =
        dir === 1
          ? cached.shift()!
          : cached.pop()!;
      const parsed = parseBeatKey(evicted);
      if (parsed) {
        queryClient.removeQueries({
          queryKey: [
            "agent-history-beat-detail",
            parsed.repoPath,
            parsed.beatId,
          ],
        });
      }
    }
  }, [
    visibleBeats,
    queryClient,
    lastScrollDirectionRef,
  ]);
}
