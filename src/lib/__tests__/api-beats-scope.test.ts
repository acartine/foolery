import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBeatsQueryKey,
  fetchBeatsForScope,
  resolveBeatsScope,
} from "@/lib/api";
import type { RegisteredRepo } from "@/lib/types";

const repoA: RegisteredRepo = {
  path: "/tmp/repo-a",
  name: "repo-a",
  addedAt: "2026-01-01T00:00:00Z",
};

const repoB: RegisteredRepo = {
  path: "/tmp/repo-b",
  name: "repo-b",
  addedAt: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("beats API scope helpers", () => {
  it("uses repo paths rather than repo count in all-repo scope keys", () => {
    const scopeA = resolveBeatsScope(null, [repoA, repoB]);
    const scopeB = resolveBeatsScope(null, [
      repoA,
      { ...repoB, path: "/tmp/repo-c", name: "repo-c" },
    ]);

    expect(scopeA.kind).toBe("all");
    expect(scopeA.key).not.toBe(scopeB.key);
  });

  it("builds stable query keys from scope and params", () => {
    const scope = resolveBeatsScope(null, [repoB, repoA]);
    expect(
      buildBeatsQueryKey(
        "queues",
        { state: "queued", type: "task" },
        scope,
      ),
    ).toEqual([
      "beats",
      "queues",
      "all:/tmp/repo-a|/tmp/repo-b",
      "{\"state\":\"queued\",\"type\":\"task\"}",
    ]);
  });

  it("requests the aggregate beats route for all-repositories scope", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "beat-1", title: "Beat 1" }],
          _degraded: "partial",
        }),
      } as Response);

    const scope = resolveBeatsScope(null, [repoA, repoB]);
    const result = await fetchBeatsForScope(
      { state: "queued" },
      scope,
      [repoA, repoB],
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/beats?state=queued&scope=all",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: [{ id: "beat-1", title: "Beat 1" }],
      _degraded: "partial",
    });
  });
});
