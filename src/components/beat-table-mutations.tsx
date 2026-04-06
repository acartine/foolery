import { useCallback } from "react";
import {
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { invalidateBeatListQueries } from "@/lib/beat-query-cache";
import {
  closeBeat,
  previewCascadeClose,
  cascadeCloseBeat,
} from "@/lib/api";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";
import type { CascadeDescendant } from "@/lib/cascade-close";

export function repoPathForBeat(
  beat: Beat | undefined,
): string | undefined {
  const record = beat as
    | (Beat & { _repoPath?: unknown })
    | undefined;
  const repoPath = record?._repoPath;
  return typeof repoPath === "string" &&
    repoPath.trim().length > 0
    ? repoPath
    : undefined;
}

type UpdateArgs = {
  id: string;
  fields: UpdateBeatInput;
  repoPath?: string;
};

export function useUpdateBeatMutation(data: Beat[]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id, fields, repoPath,
    }: UpdateArgs) =>
      updateBeatOrThrow(data, id, fields, repoPath),
    onMutate: async ({ id, fields, repoPath }) => {
      await queryClient.cancelQueries({
        queryKey: ["beats"],
      });
      const previousBeats = queryClient.getQueriesData(
        { queryKey: ["beats"] },
      );

      queryClient.setQueriesData(
        { queryKey: ["beats"] },
        (old: unknown) => {
          const prev = old as
            | { ok: boolean; data?: Beat[] }
            | undefined;
          if (!prev?.data) return prev;
          return {
            ...prev,
            data: prev.data.map((b) =>
              b.id === id &&
              (repoPath === undefined ||
                repoPathForBeat(b) === repoPath)
                ? {
                  ...b,
                  ...fields,
                  updated: new Date().toISOString(),
                }
                : b,
            ),
          };
        },
      );

      return { previousBeats };
    },
    onError: (error, _vars, context) => {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update beat";
      toast.error(message);
      if (context?.previousBeats) {
        for (const [
          key,
          snapData,
        ] of context.previousBeats) {
          queryClient.setQueryData(key, snapData);
        }
      }
    },
    onSettled: (_data, _err, { id }) => {
      void invalidateBeatListQueries(queryClient);
      void queryClient.invalidateQueries({
        queryKey: ["beat", id],
      });
    },
  });
}

export function useCloseBeatMutation(data: Beat[]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      const beat = data.find((b) => b.id === id);
      const repo = repoPathForBeat(beat);
      return closeBeat(id, {}, repo);
    },
    onSuccess: () => {
      void invalidateBeatListQueries(queryClient);
      toast.success("Beat closed");
    },
    onError: () => {
      toast.error("Failed to close beat");
    },
  });
}

export function useCascadeCloseMutation(
  data: Beat[],
  setCascadeDialogOpen: (v: boolean) => void,
  setCascadeBeat: (b: Beat | null) => void,
  setCascadeDescendants: (d: CascadeDescendant[]) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      const beat = data.find((b) => b.id === id);
      const repo = repoPathForBeat(beat);
      return cascadeCloseBeat(id, {}, repo);
    },
    onSuccess: (_data, id) => {
      void invalidateBeatListQueries(queryClient);
      const beat = data.find((b) => b.id === id);
      toast.success(
        `Closed ${beat?.title ?? id} and all children`,
      );
      setCascadeDialogOpen(false);
      setCascadeBeat(null);
      setCascadeDescendants([]);
    },
    onError: () => {
      toast.error("Failed to cascade close");
    },
  });
}

export function useInitiateClose(
  data: Beat[],
  handleCloseBeat: (id: string) => void,
  setCascadeBeat: (b: Beat | null) => void,
  setCascadeLoading: (v: boolean) => void,
  setCascadeDialogOpen: (v: boolean) => void,
  setCascadeDescendants: (d: CascadeDescendant[]) => void,
) {
  return useCallback(
    async (beatId: string) => {
      const hasChildren = data.some(
        (b) =>
          b.parent === beatId &&
          b.state !== "shipped" &&
          b.state !== "closed",
      );
      if (!hasChildren) {
        handleCloseBeat(beatId);
        return;
      }
      const beat = data.find((b) => b.id === beatId);
      if (!beat) return;
      setCascadeBeat(beat);
      setCascadeLoading(true);
      setCascadeDialogOpen(true);
      const repo = repoPathForBeat(beat);
      const result = await previewCascadeClose(
        beatId,
        repo,
      );
      setCascadeLoading(false);
      if (result.ok && result.data) {
        setCascadeDescendants(
          result.data.descendants,
        );
      }
    },
    [
      data,
      handleCloseBeat,
      setCascadeBeat,
      setCascadeLoading,
      setCascadeDialogOpen,
      setCascadeDescendants,
    ],
  );
}
