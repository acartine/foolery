import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";

const mockList = vi.fn();
const mockSearch = vi.fn();
const mockAggregate = vi.fn();
const mockStream = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    list: (...args: unknown[]) => mockList(...args),
    search: (...args: unknown[]) => mockSearch(...args),
  }),
}));

vi.mock("@/lib/beats-multi-repo", () => ({
  listBeatsAcrossRegisteredRepos: (...args: unknown[]) =>
    mockAggregate(...args),
  streamBeatsAcrossRegisteredRepos: (...args: unknown[]) =>
    mockStream(...args),
  aggregateBeatsErrorStatus: (error: string) =>
    error === DEGRADED_ERROR_MESSAGE ? 503 : 500,
}));

import { GET } from "@/app/api/beats/route";

describe("GET /api/beats scope=all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the aggregate loader and returns partial-failure metadata", async () => {
    mockAggregate.mockResolvedValue({
      ok: true,
      data: [{ id: "beat-1", title: "Beat 1" }],
      _degraded: "Failed to load 1 repositories; showing partial results.",
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/beats?scope=all&state=queued",
    ));
    const json = await response.json();

    expect(mockAggregate).toHaveBeenCalledWith(
      { state: "queued" },
      undefined,
    );
    expect(mockList).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(json).toEqual({
      data: [{ id: "beat-1", title: "Beat 1" }],
      _degraded: "Failed to load 1 repositories; showing partial results.",
    });
  });

  it("returns an aggregate error status when all repositories fail", async () => {
    mockAggregate.mockResolvedValue({
      ok: false,
      error: DEGRADED_ERROR_MESSAGE,
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/beats?scope=all&state=queued",
    ));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({ error: DEGRADED_ERROR_MESSAGE });
  });

  it("streams NDJSON when Accept header is application/x-ndjson", async () => {
    async function* fakeStream() {
      yield {
        repo: "/tmp/a",
        repoName: "repo-a",
        beats: [{ id: "a1", title: "A1" }],
      };
      yield {
        done: true as const,
        allBeats: [{ id: "a1", title: "A1" }],
        totalErrors: 0,
      };
    }
    mockStream.mockReturnValue(fakeStream());

    const req = new NextRequest(
      "http://localhost/api/beats?scope=all&state=queued",
      { headers: { Accept: "application/x-ndjson" } },
    );
    const response = await GET(req);

    expect(response.headers.get("content-type"))
      .toBe("application/x-ndjson");

    const text = await response.text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);

    const chunk = JSON.parse(lines[0]!);
    expect(chunk).toMatchObject({
      repo: "/tmp/a",
      repoName: "repo-a",
    });

    const summary = JSON.parse(lines[1]!);
    expect(summary).toMatchObject({
      done: true,
      totalErrors: 0,
    });
  });
});
