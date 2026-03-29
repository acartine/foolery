import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { BEAT_LIST_QUERY_KEY, invalidateBeatListQueries } from "@/lib/beat-query-cache";

describe("beat-query-cache", () => {
  it("uses the shared beat list query key", () => {
    expect(BEAT_LIST_QUERY_KEY).toEqual(["beats"]);
  });

  it("invalidates beat list queries with the shared key", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries,
    } as unknown as Pick<QueryClient, "invalidateQueries">;

    await invalidateBeatListQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["beats"],
      refetchType: "active",
    });
  });
});
