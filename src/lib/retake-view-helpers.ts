import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
} from "@/lib/api";
import { useRepoSwitchQueryState } from "@/hooks/use-repo-switch-query-state";
import {
  RETAKE_TARGET_STATE, isRetakeSourceState,
} from "@/lib/retake";
import { startSession } from "@/lib/terminal-api";
import { hasRollingAncestor } from "@/lib/rolling-ancestor";
import {
  findRunningTerminalForBeat,
  getBeatRepoPath,
  repoScopedBeatKey,
} from "@/lib/retake-session-scope";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";
import type { UpdateBeatInput } from "@/lib/schemas";
import type { Beat, RegisteredRepo } from "@/lib/types";
import type { ActiveTerminal } from "@/stores/terminal-store";
import type { RetakeAction } from "@/components/retake-dialog";

export type RetakesQueryResult = {
  ok: true;
  data: Beat[];
  allBeats: Beat[];
};

export type RetakeMutationResult = {
  staged: true;
  sessionResult:
    | "already-running"
    | "ancestor-rolling"
    | "started"
    | "start-failed"
    | "stage-only";
  sessionError?: string;
};

async function loadRepo(
  activeRepo: string | null | undefined,
  registeredRepos: RegisteredRepo[],
): Promise<RetakesQueryResult> {
  const scope = resolveBeatsScope(activeRepo, registeredRepos);
  const result = await fetchBeatsForScope(
    {},
    scope,
    registeredRepos,
  );
  if (!result.ok) {
    throw new Error(
      result.error ?? "Failed to load retake beats.",
    );
  }
  const allBeats = result.data ?? [];
  return {
    ok: true,
    data: allBeats.filter(
      (beat) => isRetakeSourceState(beat.state),
    ),
    allBeats,
  };
}

export function useRetakesQuery(
  activeRepo: string | null | undefined,
  registeredRepos: RegisteredRepo[],
) {
  const scope = resolveBeatsScope(activeRepo, registeredRepos);
  const query = useQuery({
    queryKey: buildBeatsQueryKey(
      "retakes",
      {},
      scope,
    ),
    queryFn: () => loadRepo(activeRepo, registeredRepos),
    enabled: true,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const display = useRepoSwitchQueryState(scope.key, {
    data: query.data,
    error: query.error,
    fetchStatus: query.fetchStatus,
    isFetched: query.isFetched,
    isLoading: query.isLoading,
  });

  return {
    ...query,
    data: display.data,
    isLoading: display.isLoading,
  };
}

export function handleRetakeSuccess(
  result: RetakeMutationResult | undefined,
  queryClient: ReturnType<typeof useQueryClient>,
  setDialogOpen: (v: boolean) => void,
  setRetakeBeat: (v: Beat | null) => void,
) {
  queryClient.invalidateQueries({ queryKey: ["beats"] });
  setDialogOpen(false);
  setRetakeBeat(null);

  if (!result) {
    toast.success(
      "ReTake staged — beat reopened for investigation",
    );
    return;
  }

  switch (result.sessionResult) {
    case "stage-only":
      toast.success(
        "ReTake staged — beat reopened for investigation",
      );
      break;
    case "started":
      toast.success("ReTake staged and session started");
      break;
    case "already-running":
      toast.info(
        "ReTake staged — opened existing active session",
      );
      break;
    case "ancestor-rolling":
      toast.info(
        "ReTake staged — parent beat is already rolling,"
        + " session not started",
      );
      break;
    case "start-failed": {
      const err = (
        result as { sessionError?: string }
      ).sessionError ?? "unknown error";
      toast.info(
        "ReTake staged but session failed to start: "
        + err,
      );
      break;
    }
  }
}

export async function executeRetakeNow(
  beat: Beat,
  repo: string | undefined,
  activeRepo: string | null | undefined,
  terminals: ActiveTerminal[],
  parentByBeatId: Map<string, string | undefined>,
  shippingByBeatId: Record<string, string>,
  setActiveSession: (id: string) => void,
  upsertTerminal: (t: ActiveTerminal) => void,
): Promise<RetakeMutationResult> {
  const existing = findRunningTerminalForBeat(
    terminals, beat.id, repo,
  );
  if (existing) {
    setActiveSession(existing.sessionId);
    return {
      staged: true, sessionResult: "already-running",
    };
  }

  if (hasRollingAncestor(
    {
      id: repoScopedBeatKey(beat.id, repo),
      parent: beat.parent
        ? repoScopedBeatKey(beat.parent, repo)
        : undefined,
    },
    parentByBeatId,
    shippingByBeatId,
  )) {
    return {
      staged: true, sessionResult: "ancestor-rolling",
    };
  }

  const sessionResult = await startSession(
    beat.id, repo ?? activeRepo ?? undefined,
  );
  if (!sessionResult.ok || !sessionResult.data) {
    return {
      staged: true,
      sessionResult: "start-failed",
      sessionError: sessionResult.error
        ?? "Failed to start session",
    };
  }

  const d = sessionResult.data;
  upsertTerminal({
    sessionId: d.id,
    beatId: beat.id,
    beatTitle: beat.title,
    repoPath: d.repoPath
      ?? repo ?? activeRepo ?? undefined,
    agentName: d.agentName,
    agentModel: d.agentModel,
    agentVersion: d.agentVersion,
    agentCommand: d.agentCommand,
    status: "running",
    startedAt: d.startedAt,
  });

  return { staged: true, sessionResult: "started" };
}

/** Extract the commit sha from a beat's labels. */
export function extractCommitSha(
  beat: Beat,
): string | undefined {
  const label = beat.labels?.find(
    (l) => l.startsWith("commit:"),
  );
  return label ? label.slice("commit:".length) : undefined;
}

export { getBeatRepoPath };

export function useRetakeMutation(opts: {
  beats: Beat[];
  activeRepo: string | null | undefined;
  terminals: ActiveTerminal[];
  parentByBeatId: Map<string, string | undefined>;
  shippingByBeatId: Record<string, string>;
  setActiveSession: (id: string) => void;
  upsertTerminal: (t: ActiveTerminal) => void;
  setDialogOpen: (v: boolean) => void;
  setRetakeBeat: (v: Beat | null) => void;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      { beat, notes, action }: {
        beat: Beat; notes: string; action: RetakeAction;
      },
    ) => {
      const commitSha = extractCommitSha(beat);
      const labels: string[] = [];
      if (commitSha) {
        labels.push(`regression:${commitSha}`);
      }
      const prefix = beat.notes
        ? beat.notes + "\n" : "";
      const notesText = notes
        ? `${prefix}ReTake: ${notes}`
        : prefix
          + "ReTake: reopened for regression investigation";
      const fields: UpdateBeatInput = {
        state: RETAKE_TARGET_STATE,
        labels: labels.length > 0 ? labels : undefined,
        notes: notesText,
      };
      const repo = getBeatRepoPath(beat);
      await updateBeatOrThrow(
        opts.beats, beat.id, fields, repo,
      );
      if (action === "retake-now") {
        return executeRetakeNow(
          beat, repo, opts.activeRepo,
          opts.terminals,
          opts.parentByBeatId,
          opts.shippingByBeatId,
          opts.setActiveSession,
          opts.upsertTerminal,
        );
      }
      return {
        staged: true as const,
        sessionResult: "stage-only" as const,
      };
    },
    onSuccess: (result) => handleRetakeSuccess(
      result,
      queryClient,
      opts.setDialogOpen,
      opts.setRetakeBeat,
    ),
    onError: () => {
      toast.error("Failed to initiate ReTake");
    },
  });
}
