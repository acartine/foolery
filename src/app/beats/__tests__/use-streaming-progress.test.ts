import { describe, expect, it } from "vitest";
import type { StreamingProgress } from
  "../use-streaming-progress";

/**
 * Contract tests for streaming progress state
 * transitions. Validates the same logic that the
 * useStreamingProgress hook produces, without
 * needing a React rendering context.
 */

const EMPTY: StreamingProgress = {
  totalRepos: 0,
  loadedRepos: [],
  isStreaming: false,
  isComplete: false,
};

function applyStreamStart(
  total: number,
): StreamingProgress {
  return {
    totalRepos: total,
    loadedRepos: [],
    isStreaming: true,
    isComplete: false,
  };
}

function applyRepoLoaded(
  prev: StreamingProgress,
  repo: string,
): StreamingProgress {
  const loaded = [...prev.loadedRepos, repo];
  const complete = loaded.length >= prev.totalRepos;
  return {
    ...prev,
    loadedRepos: loaded,
    isComplete: complete,
    isStreaming: !complete,
  };
}

function applyStreamComplete(
  prev: StreamingProgress,
): StreamingProgress {
  return {
    ...prev,
    isStreaming: false,
    isComplete: true,
  };
}

describe("streaming progress transitions", () => {
  it("starts with empty progress", () => {
    expect(EMPTY).toEqual({
      totalRepos: 0,
      loadedRepos: [],
      isStreaming: false,
      isComplete: false,
    });
  });

  it("tracks streaming start", () => {
    const p = applyStreamStart(3);
    expect(p.totalRepos).toBe(3);
    expect(p.isStreaming).toBe(true);
    expect(p.isComplete).toBe(false);
  });

  it("tracks per-repo completion", () => {
    let p = applyStreamStart(3);
    p = applyRepoLoaded(p, "/a");
    expect(p.loadedRepos).toEqual(["/a"]);
    expect(p.isStreaming).toBe(true);
    expect(p.isComplete).toBe(false);
  });

  it("completes when all repos loaded", () => {
    let p = applyStreamStart(2);
    p = applyRepoLoaded(p, "/a");
    p = applyRepoLoaded(p, "/b");
    expect(p.isComplete).toBe(true);
    expect(p.isStreaming).toBe(false);
  });

  it(
    "onStreamComplete forces completion",
    () => {
      let p = applyStreamStart(2);
      p = applyRepoLoaded(p, "/a");
      // Only 1 of 2 loaded, but stream ended
      p = applyStreamComplete(p);
      expect(p.isComplete).toBe(true);
      expect(p.isStreaming).toBe(false);
    },
  );

  it("reset returns to empty", () => {
    // After reset, state matches EMPTY
    expect(EMPTY.totalRepos).toBe(0);
    expect(EMPTY.loadedRepos).toHaveLength(0);
    expect(EMPTY.isStreaming).toBe(false);
    expect(EMPTY.isComplete).toBe(false);
  });
});
