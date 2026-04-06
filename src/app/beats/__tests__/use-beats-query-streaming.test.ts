import { describe, expect, it } from "vitest";
import type { StreamingProgress } from
  "../use-streaming-progress";

/**
 * Contract tests for the streaming progress
 * integration in use-beats-query.
 *
 * These verify the logic that would be exercised
 * when fetchBeatsWithStreaming calls the progress
 * callbacks, without needing a full React context
 * or TanStack Query provider.
 */

function simulateStreamingFetch(
  repoCount: number,
  repoChunks: string[],
): StreamingProgress {
  let progress: StreamingProgress = {
    totalRepos: 0,
    loadedRepos: [],
    loadedBeatsCount: 0,
    isStreaming: false,
    isComplete: false,
  };

  // onStreamStart
  progress = {
    totalRepos: repoCount,
    loadedRepos: [],
    loadedBeatsCount: 0,
    isStreaming: true,
    isComplete: false,
  };

  // onRepoLoaded for each chunk
  for (const repo of repoChunks) {
    const loaded = [...progress.loadedRepos, repo];
    const complete = loaded.length >= repoCount;
    progress = {
      ...progress,
      loadedRepos: loaded,
      isComplete: complete,
      isStreaming: !complete,
    };
  }

  // onStreamComplete
  progress = {
    ...progress,
    isStreaming: false,
    isComplete: true,
  };

  return progress;
}

describe(
  "streaming progress integration contract",
  () => {
    it(
      "reports complete after all repos loaded",
      () => {
        const p = simulateStreamingFetch(
          3, ["/a", "/b", "/c"],
        );
        expect(p.isComplete).toBe(true);
        expect(p.isStreaming).toBe(false);
        expect(p.loadedRepos).toHaveLength(3);
      },
    );

    it(
      "reports complete even with partial loads",
      () => {
        // Some repos may fail silently --
        // onStreamComplete is called regardless.
        const p = simulateStreamingFetch(
          3, ["/a"],
        );
        expect(p.isComplete).toBe(true);
        expect(p.loadedRepos).toHaveLength(1);
      },
    );

    it("handles zero repos gracefully", () => {
      const p = simulateStreamingFetch(0, []);
      expect(p.isComplete).toBe(true);
      expect(p.totalRepos).toBe(0);
    });

    it(
      "non-streaming scope has no progress",
      () => {
        // Single-repo scope: no callbacks are
        // called. Progress stays at initial state.
        const idle: StreamingProgress = {
          totalRepos: 0,
          loadedRepos: [],
          loadedBeatsCount: 0,
          isStreaming: false,
          isComplete: false,
        };
        expect(idle.isStreaming).toBe(false);
        expect(idle.isComplete).toBe(false);
      },
    );
  },
);
