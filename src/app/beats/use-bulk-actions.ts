import { useState, useCallback } from "react";
import {
  useMutation, useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";
import {
  invalidateBeatListQueries,
} from "@/lib/beat-query-cache";

const TERMINAL_STATES = new Set([
  "closed",
  "shipped",
  "abandoned",
]);

function isTerminalBeatState(
  state: string | undefined,
): boolean {
  if (!state) return false;
  return TERMINAL_STATES.has(state);
}

export interface UseBulkActionsResult {
  selectedIds: string[];
  selectionVersion: number;
  handleSelectionChange: (ids: string[]) => void;
  handleBulkUpdate: (fields: UpdateBeatInput) => void;
  handleClearSelection: () => void;
}

const TERMINAL_TARGETS = new Set([
  "shipped",
  "abandoned",
  "closed",
]);

/** @internal Exported for testing. */
export function partitionEligibleForTerminalTarget(
  ids: string[],
  beats: Beat[],
  targetState: string,
): { eligibleIds: string[]; skippedIds: string[] } {
  const targetNormalized = targetState.trim().toLowerCase();
  const eligibleIds: string[] = [];
  const skippedIds: string[] = [];
  for (const id of ids) {
    const beat = beats.find((b) => b.id === id);
    const currentState = beat?.state?.trim().toLowerCase();
    if (
      currentState === targetNormalized
      || isTerminalBeatState(currentState)
    ) {
      skippedIds.push(id);
    } else {
      eligibleIds.push(id);
    }
  }
  return { eligibleIds, skippedIds };
}

export function useBulkActions(
  beats: Beat[],
): UseBulkActionsResult {
  const [selectedIds, setSelectedIds] =
    useState<string[]>([]);
  const [selectionVersion, setSelectionVersion] =
    useState(0);
  const queryClient = useQueryClient();

  const { mutate: bulkUpdate } = useMutation({
    mutationFn: async (
      { ids, fields }: {
        ids: string[];
        fields: UpdateBeatInput;
      },
    ) => {
      await Promise.all(
        ids.map((id) =>
          updateBeatOrThrow(beats, id, fields)),
      );
    },
    onSuccess: () => {
      void invalidateBeatListQueries(queryClient);
      setSelectionVersion((v) => v + 1);
      toast.success("Beats updated");
    },
    onError: (error) => {
      const message = error instanceof Error
        ? error.message
        : "Failed to update beats";
      toast.error(message);
    },
  });

  const handleSelectionChange = useCallback(
    (ids: string[]) => { setSelectedIds(ids); },
    [],
  );

  const handleBulkUpdate = useCallback(
    (fields: UpdateBeatInput) => {
      if (selectedIds.length === 0) return;
      const targetState = fields.state?.trim().toLowerCase();
      if (
        targetState
        && TERMINAL_TARGETS.has(targetState)
      ) {
        const { eligibleIds, skippedIds } =
          partitionEligibleForTerminalTarget(
            selectedIds, beats, targetState,
          );
        if (skippedIds.length > 0) {
          toast.info(
            `Skipped ${skippedIds.length} already-terminal `
            + `${skippedIds.length === 1 ? "beat" : "beats"}`,
          );
        }
        if (eligibleIds.length === 0) return;
        bulkUpdate({ ids: eligibleIds, fields });
        return;
      }
      bulkUpdate({ ids: selectedIds, fields });
    },
    [selectedIds, beats, bulkUpdate],
  );

  const handleClearSelection = useCallback(() => {
    setSelectionVersion((v) => v + 1);
  }, []);

  return {
    selectedIds,
    selectionVersion,
    handleSelectionChange,
    handleBulkUpdate,
    handleClearSelection,
  };
}
