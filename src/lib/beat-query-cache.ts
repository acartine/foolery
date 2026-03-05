import type { QueryClient } from "@tanstack/react-query";

export const BEAT_LIST_QUERY_KEY = ["beats"] as const;

type QueryClientLike = Pick<QueryClient, "invalidateQueries">;

/**
 * Invalidate beat list queries so completion/focus-driven UI updates refresh immediately,
 * including when list observers are currently inactive.
 */
export function invalidateBeatListQueries(queryClient: QueryClientLike): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: [...BEAT_LIST_QUERY_KEY],
    refetchType: "all",
  });
}
