import { describe, expect, it } from "vitest";
import type { StreamingProgress } from
  "@/app/beats/use-streaming-progress";

/**
 * Pure-logic tests for streaming progress bar
 * display derivations (no DOM rendering needed).
 */

function deriveLabel(p: StreamingProgress): string {
  if (p.isComplete) return "All repositories loaded";
  return `Loaded ${p.loadedRepos.length}`
    + `/${p.totalRepos} repositories`;
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
    isStreaming: true,
    isComplete: false,
  };

  it("shows 0/5 at start", () => {
    expect(derivePct(base)).toBe(0);
    expect(deriveLabel(base)).toBe(
      "Loaded 0/5 repositories",
    );
  });

  it("shows 60% at 3/5", () => {
    const p = {
      ...base,
      loadedRepos: ["/a", "/b", "/c"],
    };
    expect(derivePct(p)).toBe(60);
    expect(deriveLabel(p)).toBe(
      "Loaded 3/5 repositories",
    );
  });

  it("shows completion label", () => {
    const p: StreamingProgress = {
      totalRepos: 5,
      loadedRepos: ["/a", "/b", "/c", "/d", "/e"],
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
      isStreaming: false,
      isComplete: false,
    };
    expect(deriveVisible(idle, false)).toBe(false);
  });

  it("handles 0 total repos", () => {
    const empty: StreamingProgress = {
      totalRepos: 0,
      loadedRepos: [],
      isStreaming: true,
      isComplete: false,
    };
    expect(derivePct(empty)).toBe(0);
  });
});
