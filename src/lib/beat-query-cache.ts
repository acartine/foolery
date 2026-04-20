import type { QueryClient } from "@tanstack/react-query";

export const BEAT_LIST_QUERY_KEY = ["beats"] as const;
export const SETLIST_PLAN_QUERY_KEY = ["setlist-plan"] as const;
export const SETLIST_PLAN_BEAT_QUERY_KEY =
  ["setlist-plan-beat"] as const;

type QueryClientLike = Pick<QueryClient, "invalidateQueries">;

/**
 * Invalidate beat list and Setlist beat-detail queries so active observers
 * refresh immediately while inactive screen caches remain warm and update on
 * their next background cycle.
 */
export function invalidateBeatListQueries(
  queryClient: QueryClientLike,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...BEAT_LIST_QUERY_KEY],
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: [...SETLIST_PLAN_QUERY_KEY],
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: [...SETLIST_PLAN_BEAT_QUERY_KEY],
      refetchType: "active",
    }),
  ]).then(() => undefined);
}
