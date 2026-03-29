import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AgentHistoryBeatSummary,
} from "@/lib/agent-history-types";
import {
  fetchAgentHistory,
} from "@/lib/agent-history-api";
import { withClientPerfSpan } from "@/lib/client-perf";
import { useAppStore } from "@/stores/app-store";
import {
  useInteractionPicker,
} from "@/components/interaction-picker";
import { toast } from "sonner";
import {
  beatKey,
  parseMillis,
  stripIdPrefix,
} from "@/components/agent-history-utils";
import {
  useBeatNavigation,
} from "./use-beat-navigation";
import {
  useBeatDetailQueries,
} from "./use-beat-detail-queries";

export function useAgentHistoryState() {
  const { activeRepo, registeredRepos } =
    useAppStore();

  const copyBeatId = useCallback(
    (beatId: string) => {
      const shortId = stripIdPrefix(beatId);
      navigator.clipboard.writeText(shortId).then(
        () => toast.success(`Copied: ${shortId}`),
        () => toast.error("Failed to copy to clipboard"),
      );
    },
    [],
  );

  const beatsQuery = useBeatsQuery(
    activeRepo,
    registeredRepos.length,
  );

  const beats = useMemo(() => {
    if (!beatsQuery.data?.ok) return [];
    return (
      beatsQuery.data.data?.beats ?? []
    ).sort(
      (a, b) =>
        parseMillis(b.lastWorkedAt)
        - parseMillis(a.lastWorkedAt),
    );
  }, [beatsQuery.data]);

  const nav = useBeatNavigation(beats);
  const details = useBeatDetailQueries({
    visibleBeats: nav.visibleBeats,
    focusedBeatKey: nav.focusedBeatKey,
    loadedBeatKey: nav.loadedBeatKey,
    windowStart: nav.windowStart,
    beats,
    lastScrollDirectionRef:
      nav.lastScrollDirectionRef,
  });

  const session = useSessionState(
    activeRepo,
    details.loadedBeat,
    nav.loadedBeatKey,
  );

  const derived = useDerivedState(
    nav,
    details,
    registeredRepos,
    activeRepo,
  );

  return {
    activeRepo,
    registeredRepos,
    ...nav,
    ...details,
    ...session,
    ...derived,
    copyBeatId,
    beatsQuery,
    beats,
  };
}

function useBeatsQuery(
  activeRepo: string | null,
  repoCount: number,
) {
  return useQuery({
    queryKey: [
      "agent-history",
      "beats",
      activeRepo,
    ],
    queryFn: () =>
      withClientPerfSpan(
        "query",
        "agent-history:beats",
        () => fetchAgentHistory({
          repoPath: activeRepo ?? undefined,
        }),
      ),
    enabled:
      Boolean(activeRepo) || repoCount > 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
  });
}

function useSessionState(
  activeRepo: string | null,
  loadedBeat: {
    beatId: string;
    repoPath: string;
  } | null,
  loadedBeatKey: string | null,
) {
  const [debugPanelOpen, setDebugPanelOpen] =
    useState(false);
  const [showExpandedDetails, setShowExpandedDetails] = useState(false);
  const [selectedSessionId, setSelectedSessionId] =
    useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: [
      "agent-history",
      "sessions",
      activeRepo,
      loadedBeat?.repoPath ?? null,
      loadedBeat?.beatId ?? null,
    ],
    queryFn: () =>
      withClientPerfSpan(
        "query",
        "agent-history:sessions",
        () => fetchAgentHistory({
          repoPath: activeRepo ?? undefined,
          beatId: loadedBeat!.beatId,
          beatRepoPath: loadedBeat!.repoPath,
        }),
      ),
    enabled: Boolean(loadedBeat),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const sessions = useMemo(() => {
    if (!sessionsQuery.data?.ok) return [];
    return (
      sessionsQuery.data.data?.sessions ?? []
    );
  }, [sessionsQuery.data]);

  const picker = useInteractionPicker(sessions);

  const selectedDebugSession = useMemo(() => {
    if (sessions.length === 0) return null;
    if (!selectedSessionId) {
      return sessions[0] ?? null;
    }
    return (
      sessions.find(
        (s) =>
          s.sessionId === selectedSessionId,
      ) ?? sessions[0] ?? null
    );
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync
    setDebugPanelOpen(false);
  }, [loadedBeatKey]);

  useEffect(() => {
    if (sessions.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync
      setSelectedSessionId(null);
      return;
    }
    if (
      !selectedSessionId
      || !sessions.some(
        (s) =>
          s.sessionId === selectedSessionId,
      )
    ) {
      setSelectedSessionId(
        sessions[0]?.sessionId ?? null,
      );
    }
  }, [selectedSessionId, sessions]);

  return {
    debugPanelOpen,
    setDebugPanelOpen,
    showExpandedDetails,
    setShowExpandedDetails,
    selectedSessionId,
    setSelectedSessionId,
    sessionsQuery,
    sessions,
    picker,
    selectedDebugSession,
  };
}

function useDerivedState(
  nav: ReturnType<typeof useBeatNavigation>,
  details: ReturnType<
    typeof useBeatDetailQueries
  >,
  registeredRepos: Array<{
    path: string;
    name: string;
  }>,
  activeRepo: string | null,
) {
  const repoNames = useMemo(
    () =>
      new Map(
        registeredRepos.map(
          (r) => [r.path, r.name],
        ),
      ),
    [registeredRepos],
  );

  const showRepoName =
    !activeRepo && registeredRepos.length > 1;

  const getBeatTitle = useCallback(
    (
      summary: AgentHistoryBeatSummary | null,
    ): string => {
      if (!summary) return "";
      const hinted = summary.title?.trim();
      if (hinted) return hinted;
      const key = beatKey(
        summary.beatId,
        summary.repoPath,
      );
      const detail =
        details.beatDetailMap.get(key);
      if (detail?.title?.trim()) {
        return detail.title.trim();
      }
      return summary.beatId;
    },
    [details.beatDetailMap],
  );

  const focusedTitle = nav.focusedSummary
    ? getBeatTitle(nav.focusedSummary)
    : "Beat details";
  const loadedTitle = nav.loadedSummary
    ? getBeatTitle(nav.loadedSummary)
    : null;

  return {
    repoNames,
    showRepoName,
    getBeatTitle,
    focusedTitle,
    loadedTitle,
  };
}
