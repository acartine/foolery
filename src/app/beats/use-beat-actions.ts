import { useState, useCallback } from "react";
import type { ActiveTerminal } from "@/stores/terminal-store";
import type { Beat } from "@/lib/types";
import { refineBeatScope } from "@/lib/api";
import { toast } from "sonner";
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

  const { handleShipBeat, handleAbortShipping } =
    useShipBeat(terminals, hasRollingAncestor);

  const { handleSceneBeats } = useSceneManager(
    beats, terminals, handleShipBeat,
  );
  const markPending = useScopeRefinementPendingStore(
    (s) => s.markPending,
  );

  const normalizeRepoPath = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

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
      const targets = ids.map((id) => {
        const beat = beats.find((entry) => entry.id === id);
        return {
          id,
          repoPath: resolveRepoForBeat(beat),
        };
      });
      if (targets.length === 0) return;

      const results = await Promise.allSettled(
        targets.map(({ id, repoPath }) =>
          refineBeatScope(id, repoPath)),
      );
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const target = targets[i];
        if (
          result.status === "fulfilled"
          && result.value.ok
        ) {
          markPending(target.id);
          successCount += 1;
        } else {
          failureCount += 1;
        }
      }

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
    },
    [beats, markPending, resolveRepoForBeat],
  );

  return {
    mergeDialogOpen, setMergeDialogOpen,
    mergeBeatIds, handleMergeBeats,
    handleShipBeat, handleAbortShipping,
    handleSceneBeats, handleRefineScope,
  };
}
