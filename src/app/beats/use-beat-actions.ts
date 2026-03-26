import { useState, useCallback } from "react";
import type { ActiveTerminal } from "@/stores/terminal-store";
import type { Beat } from "@/lib/types";
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
}

export function useBeatActions(
  beats: Beat[],
  terminals: ActiveTerminal[],
  shippingByBeatId: Record<string, string>,
  hasRollingAncestor: (
    beat: Pick<Beat, "id" | "parent">,
  ) => boolean,
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

  const handleMergeBeats = useCallback(
    (ids: string[]) => {
      setMergeBeatIds(ids);
      setMergeDialogOpen(true);
    },
    [],
  );

  return {
    mergeDialogOpen, setMergeDialogOpen,
    mergeBeatIds, handleMergeBeats,
    handleShipBeat, handleAbortShipping,
    handleSceneBeats,
  };
}
