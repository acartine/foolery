import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  BEAT_LIST_QUERY_KEY,
  SETLIST_PLAN_BEAT_QUERY_KEY,
  SETLIST_PLAN_QUERY_KEY,
  invalidateBeatListQueries,
} from "@/lib/beat-query-cache";

describe("beat-query-cache", () => {
  it("uses the shared beat list query key", () => {
    expect(BEAT_LIST_QUERY_KEY).toEqual(["beats"]);
  });

  it("uses the shared setlist query keys", () => {
    expect(SETLIST_PLAN_QUERY_KEY).toEqual(["setlist-plan"]);
    expect(SETLIST_PLAN_BEAT_QUERY_KEY).toEqual(
      ["setlist-plan-beat"],
    );
  });

  it("invalidates beat list and setlist queries with the shared keys", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries,
    } as unknown as Pick<QueryClient, "invalidateQueries">;

    await invalidateBeatListQueries(queryClient);

    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["beats"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["setlist-plan"],
      refetchType: "active",
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["setlist-plan-beat"],
      refetchType: "active",
    });
  });
});
