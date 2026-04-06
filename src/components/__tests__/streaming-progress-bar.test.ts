import { describe, expect, it } from "vitest";
import type { StreamingProgress } from
  "@/app/beats/use-streaming-progress";

/**
 * Pure-logic tests for streaming progress bar
 * display derivations (no DOM rendering needed).
 */

function deriveLabel(p: StreamingProgress): string {
  if (!p.isStreaming && p.isComplete) {
    return "All repositories loaded";
  }
  if (p.loadedBeatsCount > 0) {
    return `Loading\u2026 ${p.loadedBeatsCount} beats`
      + ` from ${p.loadedRepos.length}`
      + `/${p.totalRepos} repos`;
  }
  return `Loading ${p.totalRepos} repositories\u2026`;
}

function derivePct(p: StreamingProgress): number {
  if (p.totalRepos === 0) return 0;
  return Math.round(
    (p.loadedRepos.length / p.totalRepos) * 100,
  );
}

function deriveVisible(
  p: StreamingProgress,
  dismissed: boolean,
): boolean {
  const showBar = p.isStreaming || p.isComplete;
  return showBar && !dismissed;
}

describe("streaming progress bar logic", () => {
  const base: StreamingProgress = {
    totalRepos: 5,
    loadedRepos: [],
    loadedBeatsCount: 0,
    isStreaming: true,
    isComplete: false,
  };

  it("shows loading at start", () => {
    expect(derivePct(base)).toBe(0);
    expect(deriveLabel(base)).toBe(
      "Loading 5 repositories\u2026",
    );
  });

  it("shows beat count at 3/5 repos", () => {
    const p = {
      ...base,
      loadedRepos: ["/a", "/b", "/c"],
      loadedBeatsCount: 42,
    };
    expect(derivePct(p)).toBe(60);
    expect(deriveLabel(p)).toBe(
      "Loading\u2026 42 beats from 3/5 repos",
    );
  });

  it("shows completion label", () => {
    const p: StreamingProgress = {
      totalRepos: 5,
      loadedRepos: ["/a", "/b", "/c", "/d", "/e"],
      loadedBeatsCount: 50,
      isStreaming: false,
      isComplete: true,
    };
    expect(derivePct(p)).toBe(100);
    expect(deriveLabel(p)).toBe(
      "All repositories loaded",
    );
  });

  it("is visible while streaming", () => {
    expect(deriveVisible(base, false)).toBe(true);
  });

  it("is visible after completion", () => {
    const p: StreamingProgress = {
      ...base,
      isStreaming: false,
      isComplete: true,
    };
    expect(deriveVisible(p, false)).toBe(true);
  });

  it("hides after dismissal", () => {
    const p: StreamingProgress = {
      ...base,
      isStreaming: false,
      isComplete: true,
    };
    expect(deriveVisible(p, true)).toBe(false);
  });

  it("not visible when idle", () => {
    const idle: StreamingProgress = {
      totalRepos: 0,
      loadedRepos: [],
      loadedBeatsCount: 0,
      isStreaming: false,
      isComplete: false,
    };
    expect(deriveVisible(idle, false)).toBe(false);
  });

  it("handles 0 total repos", () => {
    const empty: StreamingProgress = {
      totalRepos: 0,
      loadedRepos: [],
      loadedBeatsCount: 0,
      isStreaming: true,
      isComplete: false,
    };
    expect(derivePct(empty)).toBe(0);
  });
});
