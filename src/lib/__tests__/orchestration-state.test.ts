import { afterEach, describe, expect, it, vi } from "vitest";

// Mock sessionStorage before importing the module under test
const store = new Map<string, string>();
const mockSessionStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};

vi.stubGlobal("window", { sessionStorage: mockSessionStorage });

import {
  clearOrchestrationViewState,
  loadOrchestrationViewState,
  ORCHESTRATION_VIEW_STATE_KEY,
  saveOrchestrationViewState,
  type OrchestrationViewState,
} from "@/lib/orchestration-state";

function makeState(
  overrides: Partial<OrchestrationViewState> = {}
): OrchestrationViewState {
  return {
    session: null,
    plan: null,
    objective: "test objective",
    waveEdits: {},
    statusText: "Ready",
    logLines: [],
    applyResult: null,
    repoPath: "/tmp/test-repo",
    savedAt: Date.now(),
    ...overrides,
  };
}

describe("orchestration-state", () => {
  afterEach(() => {
    store.clear();
  });

  it("round-trips save and load", () => {
    const state = makeState({
      objective: "plan the next wave",
      logLines: [
        { id: "1", type: "plain", text: "hello" },
        { id: "2", type: "structured", event: "plan", text: "wave 1", extras: [] },
      ],
      waveEdits: { 0: { name: "Wave Alpha", slug: "alpha" } },
    });

    saveOrchestrationViewState(state);
    const loaded = loadOrchestrationViewState("/tmp/test-repo");

    expect(loaded).not.toBeNull();
    expect(loaded!.objective).toBe("plan the next wave");
    expect(loaded!.logLines).toHaveLength(2);
    expect(loaded!.waveEdits).toEqual({ "0": { name: "Wave Alpha", slug: "alpha" } });
  });

  it("returns null for stale state (>30 min)", () => {
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    const state = makeState({ savedAt: thirtyOneMinutesAgo });

    saveOrchestrationViewState(state);
    const loaded = loadOrchestrationViewState("/tmp/test-repo");

    expect(loaded).toBeNull();
    // Should also have cleaned up sessionStorage
    expect(store.has(ORCHESTRATION_VIEW_STATE_KEY)).toBe(false);
  });

  it("returns null for repo mismatch", () => {
    const state = makeState({ repoPath: "/tmp/other-repo" });
    saveOrchestrationViewState(state);

    const loaded = loadOrchestrationViewState("/tmp/test-repo");
    expect(loaded).toBeNull();
  });

  it("returns null when nothing saved", () => {
    const loaded = loadOrchestrationViewState("/tmp/test-repo");
    expect(loaded).toBeNull();
  });

  it("clears saved state", () => {
    saveOrchestrationViewState(makeState());
    expect(store.has(ORCHESTRATION_VIEW_STATE_KEY)).toBe(true);

    clearOrchestrationViewState();
    expect(store.has(ORCHESTRATION_VIEW_STATE_KEY)).toBe(false);
  });

  it("handles corrupted JSON gracefully", () => {
    store.set(ORCHESTRATION_VIEW_STATE_KEY, "not-json{{{");
    const loaded = loadOrchestrationViewState("/tmp/test-repo");

    expect(loaded).toBeNull();
    expect(store.has(ORCHESTRATION_VIEW_STATE_KEY)).toBe(false);
  });
});
