import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ActiveTerminal } from "@/stores/terminal-store";
import type { Beat } from "@/lib/types";
import { refineBeatScope, rollbackBeat } from "@/lib/api";
import { toast } from "sonner";
import {
  invalidateBeatListQueries,
} from "@/lib/beat-query-cache";
import { useScopeRefinementPendingStore } from "@/stores/scope-refinement-pending-store";
import { useShipBeat } from "./use-ship-beat";
import { useSceneManager } from "./use-scene-manager";

export interface UseBeatActionsResult {
  mergeDialogOpen: boolean;
  setMergeDialogOpen: (open: boolean) => void;
  mergeBeatIds: string[];
  handleMergeBeats: (ids: string[]) => void;
  handleShipBeat: (beat: Beat) => Promise<void>;
  handleAbortShipping: (
    beatId: string,
  ) => Promise<void>;
  handleSceneBeats: (
    ids: string[],
  ) => Promise<void>;
  handleRefineScope: (ids: string[]) => Promise<void>;
  handleReleaseBeat: (beat: Beat) => Promise<void>;
}

type BeatRepoResolver = (
  beat: Beat | undefined,
) => string | undefined;

type BeatListQueryClient =
  Parameters<typeof invalidateBeatListQueries>[0];

interface RefineTarget {
  id: string;
  repoPath?: string;
}

export function useBeatActions(
  beats: Beat[],
  terminals: ActiveTerminal[],
  shippingByBeatId: Record<string, string>,
  hasRollingAncestor: (
    beat: Pick<Beat, "id" | "parent">,
  ) => boolean,
  activeRepo?: string,
): UseBeatActionsResult {
  const [mergeDialogOpen, setMergeDialogOpen] =
    useState(false);
  const [mergeBeatIds, setMergeBeatIds] =
    useState<string[]>([]);
  const queryClient = useQueryClient();

  const { handleShipBeat, handleAbortShipping } =
    useShipBeat(terminals, hasRollingAncestor);

  const { handleSceneBeats } = useSceneManager(
    beats, terminals, handleShipBeat,
  );
  const markPending = useScopeRefinementPendingStore(
    (s) => s.markPending,
  );

  const resolveRepoForBeat = useCallback(
    (beat: Beat | undefined): string | undefined => {
      const rawRepo = (beat as { _repoPath?: unknown })?._repoPath;
      return normalizeRepoPath(rawRepo) ?? activeRepo;
    },
    [activeRepo],
  );

  const handleMergeBeats = useCallback(
    (ids: string[]) => {
      setMergeBeatIds(ids);
      setMergeDialogOpen(true);
    },
    [],
  );

  const handleRefineScope = useCallback(
    async (ids: string[]) => {
      await runScopeRefinement(
        ids, beats, resolveRepoForBeat, markPending,
      );
    },
    [beats, markPending, resolveRepoForBeat],
  );

  const handleReleaseBeat = useCallback(
    async (beat: Beat) => {
      await releaseOverviewBeat(
        beat, resolveRepoForBeat(beat), queryClient,
      );
    },
    [queryClient, resolveRepoForBeat],
  );

  return {
    mergeDialogOpen, setMergeDialogOpen,
    mergeBeatIds, handleMergeBeats,
    handleShipBeat, handleAbortShipping,
    handleSceneBeats, handleRefineScope,
    handleReleaseBeat,
  };
}

function normalizeRepoPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function runScopeRefinement(
  ids: string[],
  beats: Beat[],
  resolveRepoForBeat: BeatRepoResolver,
  markPending: (id: string) => void,
): Promise<void> {
  const targets = ids.map((id) => {
    const beat = beats.find((entry) => entry.id === id);
    return { id, repoPath: resolveRepoForBeat(beat) };
  });
  if (targets.length === 0) return;

  const results = await Promise.allSettled(
    targets.map(({ id, repoPath }) =>
      refineBeatScope(id, repoPath)),
  );
  const counts = countRefineScopeResults(
    targets, results, markPending,
  );
  notifyScopeRefinement(counts.successCount, counts.failureCount);
}

function countRefineScopeResults(
  targets: RefineTarget[],
  results: PromiseSettledResult<Awaited<ReturnType<typeof refineBeatScope>>>[],
  markPending: (id: string) => void,
) {
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const target = targets[i];
    if (result.status === "fulfilled" && result.value.ok) {
      markPending(target.id);
      successCount += 1;
    } else {
      failureCount += 1;
    }
  }

  return { successCount, failureCount };
}

function notifyScopeRefinement(
  successCount: number,
  failureCount: number,
): void {
  if (successCount > 0) {
    toast.success(
      `${successCount} scope refinement${
        successCount === 1 ? "" : "s"
      } enqueued`,
    );
  }
  if (failureCount > 0) {
    toast.error(
      `${failureCount} scope refinement${
        failureCount === 1 ? "" : "s"
      } failed`,
    );
  }
}

async function releaseOverviewBeat(
  beat: Beat,
  repoPath: string | undefined,
  queryClient: BeatListQueryClient,
): Promise<void> {
  let result: Awaited<ReturnType<typeof rollbackBeat>>;
  try {
    result = await rollbackBeat(
      beat.id,
      "Released from overview because no terminal session was found.",
      repoPath,
    );
  } catch (error) {
    toast.error(error instanceof Error
      ? error.message
      : "Failed to release beat");
    return;
  }
  if (!result.ok) {
    toast.error(result.error ?? "Failed to release beat");
    return;
  }
  void invalidateBeatListQueries(queryClient);
  toast.success("Beat released");
}
