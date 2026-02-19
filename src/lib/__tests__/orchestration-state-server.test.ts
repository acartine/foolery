import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Test the server-side (window===undefined) code paths of orchestration-state.
// We must make window undefined before importing the module.

describe("orchestration-state server-side (no window)", () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    // Force window to be undefined
    vi.stubGlobal("window", undefined);
    vi.resetModules();
  });

  afterEach(() => {
    vi.stubGlobal("window", originalWindow);
    vi.restoreAllMocks();
  });

  it("saveOrchestrationViewState is a no-op when window is undefined", async () => {
    const mod = await import("@/lib/orchestration-state");
    // Should not throw
    expect(() =>
      mod.saveOrchestrationViewState({
        session: null,
        plan: null,
        objective: "test",
        waveEdits: {},
        statusText: "",
        logLines: [],
        applyResult: null,
        repoPath: "/tmp/repo",
        savedAt: Date.now(),
      })
    ).not.toThrow();
  });

  it("loadOrchestrationViewState returns null when window is undefined", async () => {
    const mod = await import("@/lib/orchestration-state");
    expect(mod.loadOrchestrationViewState("/tmp/repo")).toBeNull();
  });

  it("clearOrchestrationViewState is a no-op when window is undefined", async () => {
    const mod = await import("@/lib/orchestration-state");
    expect(() => mod.clearOrchestrationViewState()).not.toThrow();
  });
});
