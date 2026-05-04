import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockListStaleBeats = vi.fn();

vi.mock("@/lib/stale-beat-grooming-list", () => ({
  listStaleBeatSummariesForApi: (
    ...args: unknown[]
  ) => mockListStaleBeats(...args),
}));

import { GET } from "@/app/api/beats/stale-grooming/route";

describe("GET /api/beats/stale-grooming", () => {
  it("lists stale beats with repo, threshold, and limit", async () => {
    mockListStaleBeats.mockResolvedValue([
      { key: "/repo::old", beatId: "old", ageDays: 14 },
    ]);
    const request = new NextRequest(
      "http://localhost/api/beats/stale-grooming"
        + "?_repo=/repo&limit=5&ageDays=9",
    );

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockListStaleBeats).toHaveBeenCalledWith({
      repoPath: "/repo",
      scope: undefined,
      limit: 5,
      ageDays: 9,
    });
    expect(json).toEqual({
      ok: true,
      data: {
        staleBeats: [
          { key: "/repo::old", beatId: "old", ageDays: 14 },
        ],
        count: 1,
        ageDays: 9,
      },
    });
  });
});
