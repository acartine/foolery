"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  enqueueStaleBeatGroomingReviews,
  fetchStaleBeatGroomingReviews,
} from "@/lib/stale-beat-grooming-api";
import {
  deriveGroomingStatus,
  isGroomingTerminal,
  type GroomingActionState,
} from "@/lib/grooming-status";

interface BeatGroomingState extends GroomingActionState {
  startGroom: () => Promise<void>;
  isGrooming: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Failed to load grooming status";
}

export function useBeatGrooming(
  beatId: string,
  repo: string | null | undefined,
): BeatGroomingState {
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | undefined>();
  const toastedFailureJobRef = useRef<string | null>(null);

  const reviewsQuery = useQuery({
    queryKey: ["stale-beat-grooming-reviews", jobId],
    queryFn: async () => {
      const result = await fetchStaleBeatGroomingReviews();
      if (!result.ok) {
        throw new Error(result.error ?? "Failed to load grooming status");
      }
      return result.data ?? [];
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const records = query.state.data ?? [];
      const current = deriveGroomingStatus(records, jobId);
      return isGroomingTerminal(current.status) ? false : 2500;
    },
  });

  const polledStatus = useMemo(
    () => deriveGroomingStatus(reviewsQuery.data ?? [], jobId),
    [jobId, reviewsQuery.data],
  );

  const state = useMemo<GroomingActionState>(() => {
    if (startError) return { status: "failed", error: startError };
    if (reviewsQuery.error) {
      return {
        status: "failed",
        error: errorMessage(reviewsQuery.error),
      };
    }
    if (jobId && polledStatus.status === "idle") {
      return { status: "queued" };
    }
    return polledStatus;
  }, [jobId, polledStatus, reviewsQuery.error, startError]);

  useEffect(() => {
    if (state.status !== "failed" || !state.error || !jobId) return;
    if (toastedFailureJobRef.current === jobId) return;
    toastedFailureJobRef.current = jobId;
    toast.error(state.error);
  }, [jobId, state.error, state.status]);

  const startGroom = useCallback(async () => {
    if (jobId) return;
    setStartError(undefined);
    const result = await enqueueStaleBeatGroomingReviews({
      targets: [{ beatId, ...(repo ? { repoPath: repo } : {}) }],
    });
    if (!result.ok) {
      const message = result.error ?? "Failed to start grooming";
      setStartError(message);
      toast.error(message);
      return;
    }
    const nextJobId = result.data?.jobs[0]?.jobId;
    if (!nextJobId) {
      const message = "Grooming did not return a job";
      setStartError(message);
      toast.error(message);
      return;
    }
    setJobId(nextJobId);
    toastedFailureJobRef.current = null;
  }, [beatId, jobId, repo]);

  const isGrooming =
    state.status === "queued" || state.status === "running";

  return { ...state, startGroom, isGrooming };
}
