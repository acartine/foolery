import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";

const mockList = vi.fn();
const mockSearch = vi.fn();
const mockListRepos = vi.fn();

vi.mock("@/lib/backend-instance", () => ({
  getBackend: () => ({
    list: (...args: unknown[]) => mockList(...args),
    search: (...args: unknown[]) => mockSearch(...args),
  }),
}));

vi.mock("@/lib/registry", () => ({
  listRepos: () => mockListRepos(),
}));

import type { RepoBeatsChunk } from "@/lib/beats-multi-repo";
import {
  streamBeatsAcrossRegisteredRepos,
  _resetAggregateBeatsCache,
} from "@/lib/beats-multi-repo";

async function collectChunks(
  gen: AsyncGenerator<RepoBeatsChunk>,
): Promise<RepoBeatsChunk[]> {
  const chunks: RepoBeatsChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

const repoA = {
  path: "/tmp/a", name: "repo-a", addedAt: "2026-01-01",
};
const repoB = {
  path: "/tmp/b", name: "repo-b", addedAt: "2026-01-01",
};

function okBeats(ids: string[]) {
  return {
    ok: true,
    data: ids.map((id) => ({
      id, title: `Beat ${id}`,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetAggregateBeatsCache();
});

describe("stream: resolution order", () => {
  it("yields per-repo chunks fastest-first", async () => {
    mockListRepos.mockResolvedValue([repoA, repoB]);
    mockList.mockImplementation(
      (_f: unknown, path: string) => {
        if (path === "/tmp/b") {
          return Promise.resolve(okBeats(["b1"]));
        }
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(okBeats(["a1"])), 20,
          ));
      },
    );

    const chunks = await collectChunks(
      streamBeatsAcrossRegisteredRepos({}),
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      repo: "/tmp/b", repoName: "repo-b",
    });
    expect(chunks[1]).toMatchObject({
      repo: "/tmp/a", repoName: "repo-a",
    });
    const summary = chunks[2]!;
    expect(summary).toMatchObject({
      done: true, totalErrors: 0,
    });
    if (summary.done) {
      expect(summary.allBeats).toHaveLength(2);
    }
  });
});

describe("stream: partial failure", () => {
  it("carries _degraded when some repos fail", async () => {
    mockListRepos.mockResolvedValue([repoA, repoB]);
    mockList.mockImplementation(
      (_f: unknown, path: string) => {
        if (path === "/tmp/b") {
          return Promise.resolve({
            ok: false,
            error: {
              code: "INTERNAL",
              message: DEGRADED_ERROR_MESSAGE,
              retryable: false,
            },
          });
        }
        return Promise.resolve(okBeats(["a1"]));
      },
    );

    const chunks = await collectChunks(
      streamBeatsAcrossRegisteredRepos({}),
    );
    const repoChunks = chunks.filter((c) => !c.done);
    expect(repoChunks).toHaveLength(1);
    expect(repoChunks[0]).toMatchObject({
      repo: "/tmp/a",
    });
    const summary = chunks.find((c) => c.done);
    expect(summary).toBeDefined();
    if (summary?.done) {
      expect(summary._degraded).toBe(
        DEGRADED_ERROR_MESSAGE,
      );
      expect(summary.totalErrors).toBe(1);
    }
  });
});

describe("stream: edge cases", () => {
  it("yields empty summary for zero repos", async () => {
    mockListRepos.mockResolvedValue([]);
    const chunks = await collectChunks(
      streamBeatsAcrossRegisteredRepos({}),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      done: true, allBeats: [], totalErrors: 0,
    });
  });

  it("all repos fail => totalErrors matches", async () => {
    mockListRepos.mockResolvedValue([repoA, repoB]);
    mockList.mockResolvedValue({
      ok: false,
      error: {
        code: "INTERNAL",
        message: "connection refused",
        retryable: false,
      },
    });
    const chunks = await collectChunks(
      streamBeatsAcrossRegisteredRepos({}),
    );
    expect(chunks.filter((c) => !c.done)).toHaveLength(0);
    const summary = chunks.find((c) => c.done);
    if (summary?.done) {
      expect(summary.totalErrors).toBe(2);
      expect(summary.allBeats).toHaveLength(0);
    }
  });
});

describe("stream: cache", () => {
  it("serves from cache on repeat load", async () => {
    mockListRepos.mockResolvedValue([repoA]);
    mockList.mockResolvedValue(okBeats(["a1"]));

    await collectChunks(
      streamBeatsAcrossRegisteredRepos({}),
    );
    mockList.mockClear();

    const chunks = await collectChunks(
      streamBeatsAcrossRegisteredRepos({}),
    );
    expect(mockList).not.toHaveBeenCalled();
    const repoChunks = chunks.filter((c) => !c.done);
    expect(repoChunks).toHaveLength(1);
    expect(repoChunks[0]).toMatchObject({
      repo: "/tmp/a", repoName: "repo-a",
    });
  });
});
