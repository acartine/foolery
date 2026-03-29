import type { QueryClient } from "@tanstack/react-query";

export const BEAT_LIST_QUERY_KEY = ["beats"] as const;

type QueryClientLike = Pick<QueryClient, "invalidateQueries">;

/**
 * Invalidate beat list queries so active observers refresh immediately while
 * inactive screen caches remain warm and are updated on their next background cycle.
 */
export function invalidateBeatListQueries(
  queryClient: QueryClientLike,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: [...BEAT_LIST_QUERY_KEY],
    refetchType: "active",
  });
}
