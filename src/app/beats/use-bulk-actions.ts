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

export interface UseBulkActionsResult {
  selectedIds: string[];
  selectionVersion: number;
  handleSelectionChange: (ids: string[]) => void;
  handleBulkUpdate: (fields: UpdateBeatInput) => void;
  handleClearSelection: () => void;
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
      if (selectedIds.length > 0) {
        bulkUpdate({ ids: selectedIds, fields });
      }
    },
    [selectedIds, bulkUpdate],
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
