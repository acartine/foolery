import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  Beat,
  BeatDependency,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import {
  fetchBeat,
  fetchDeps,
  fetchWorkflows,
  addDep,
} from "@/lib/api";
import { updateBeatOrThrow } from "@/lib/update-beat-mutation";
import {
  invalidateBeatListQueries,
} from "@/lib/beat-query-cache";

export interface BeatDetailData {
  beat: Beat | null;
  isLoadingBeat: boolean;
  beatWorkflow: MemoryWorkflowDescriptor | null;
  deps: BeatDependency[];
  handleUpdate: (
    fields: UpdateBeatInput,
  ) => Promise<void>;
  handleAddDep: (args: {
    source: string;
    target: string;
  }) => void;
}

export function useBeatDetailData(
  open: boolean,
  detailId: string,
  repo: string | undefined,
  initialBeat: Beat | null | undefined,
): BeatDetailData {
  const queryClient = useQueryClient();

  const { data: beatData, isLoading } =
    useBeatQuery(open, detailId, repo, initialBeat);

  const { data: depsData } = useDepsQuery(
    open,
    detailId,
    repo,
  );

  const { data: workflowResult } =
    useWorkflowQuery(open, detailId, repo);

  const beat: Beat | null = beatData?.ok
    ? (beatData.data ?? null)
    : (initialBeat ?? null);

  const { mutateAsync: handleUpdate } =
    useUpdateBeatMutation(
      beat,
      detailId,
      repo,
      queryClient,
    );

  const { mutate: handleAddDep } =
    useAddDepMutation(detailId, repo, queryClient);

  const beatWorkflow = useBeatWorkflow(
    workflowResult,
    beat,
  );

  const deps: BeatDependency[] = depsData?.ok
    ? (depsData.data ?? [])
    : [];

  return {
    beat,
    isLoadingBeat: isLoading,
    beatWorkflow,
    deps,
    handleUpdate,
    handleAddDep,
  };
}

function useBeatQuery(
  open: boolean,
  detailId: string,
  repo: string | undefined,
  initialBeat: Beat | null | undefined,
) {
  return useQuery({
    queryKey: ["beat", detailId, repo],
    queryFn: () => fetchBeat(detailId, repo),
    enabled: open && detailId.length > 0,
    placeholderData: initialBeat
      ? { ok: true, data: initialBeat }
      : undefined,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

function useDepsQuery(
  open: boolean,
  detailId: string,
  repo: string | undefined,
) {
  return useQuery({
    queryKey: ["beat-deps", detailId, repo],
    queryFn: () => fetchDeps(detailId, repo),
    enabled: open && detailId.length > 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

function useWorkflowQuery(
  open: boolean,
  detailId: string,
  repo: string | undefined,
) {
  return useQuery({
    queryKey: [
      "workflows",
      repo ?? "__default__",
    ],
    queryFn: () =>
      fetchWorkflows(repo ?? undefined),
    enabled: open && detailId.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

function useBeatWorkflow(
  workflowResult:
    | {
        ok: boolean;
        data?: MemoryWorkflowDescriptor[];
      }
    | undefined,
  beat: Beat | null,
): MemoryWorkflowDescriptor | null {
  return useMemo(
    (): MemoryWorkflowDescriptor | null => {
      const workflows: MemoryWorkflowDescriptor[] =
        workflowResult?.ok && workflowResult.data
          ? workflowResult.data
          : [];
      if (workflows.length === 0 || !beat)
        return null;
      const profileId =
        beat.profileId ?? beat.workflowId;
      if (profileId) {
        const match = workflows.find(
          (w) => w.id === profileId,
        );
        if (match) return match;
      }
      return workflows[0] ?? null;
    },
    [workflowResult, beat],
  );
}

function useAddDepMutation(
  detailId: string,
  repo: string | undefined,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: ({
      source,
      target,
    }: {
      source: string;
      target: string;
    }) => addDep(source, { blocks: target }, repo),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          "beat-deps",
          detailId,
          repo,
        ],
      });
      toast.success("Dependency added");
    },
    onError: () => {
      toast.error("Failed to add dependency");
    },
  });
}

function useUpdateBeatMutation(
  beat: Beat | null,
  detailId: string,
  repo: string | undefined,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: async (
      fields: UpdateBeatInput,
    ) =>
      updateBeatOrThrow(
        beat ? [beat] : [],
        detailId,
        fields,
        repo,
      ),
    onMutate: async (fields) =>
      optimisticUpdate(
        queryClient,
        detailId,
        repo,
        fields,
      ),
    onError: (
      error: Error,
      _fields,
      context,
    ) =>
      rollbackOptimistic(
        queryClient,
        detailId,
        repo,
        error,
        context,
      ),
    onSettled: () =>
      invalidateBeatQueries(
        queryClient,
        detailId,
        repo,
      ),
  });
}

async function optimisticUpdate(
  queryClient: ReturnType<typeof useQueryClient>,
  detailId: string,
  repo: string | undefined,
  fields: UpdateBeatInput,
) {
  await queryClient.cancelQueries({
    queryKey: ["beat", detailId, repo],
  });
  await queryClient.cancelQueries({
    queryKey: ["beats"],
  });
  const previousBeat = queryClient.getQueryData([
    "beat",
    detailId,
    repo,
  ]);
  const previousBeats =
    queryClient.getQueriesData({
      queryKey: ["beats"],
    });
  queryClient.setQueryData(
    ["beat", detailId, repo],
    (old: unknown) => {
      const prev = old as
        | { ok: boolean; data?: Beat }
        | undefined;
      if (!prev?.data) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          ...fields,
          updated: new Date().toISOString(),
        },
      };
    },
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
          b.id === detailId
            ? {
                ...b,
                ...fields,
                updated:
                  new Date().toISOString(),
              }
            : b,
        ),
      };
    },
  );
  return { previousBeat, previousBeats };
}

function rollbackOptimistic(
  queryClient: ReturnType<typeof useQueryClient>,
  detailId: string,
  repo: string | undefined,
  error: Error,
  context:
    | {
        previousBeat: unknown;
        previousBeats: [
          unknown,
          unknown,
        ][];
      }
    | undefined,
) {
  toast.error(error.message);
  if (context?.previousBeat) {
    queryClient.setQueryData(
      ["beat", detailId, repo],
      context.previousBeat,
    );
  }
  if (context?.previousBeats) {
    for (const [
      key,
      snapData,
    ] of context.previousBeats) {
      queryClient.setQueryData(
        key as string[],
        snapData,
      );
    }
  }
}

function invalidateBeatQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  detailId: string,
  repo: string | undefined,
) {
  void invalidateBeatListQueries(queryClient);
  void queryClient.invalidateQueries({
    queryKey: ["beat", detailId, repo],
  });
}
