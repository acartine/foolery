import { describe, expect, it } from "vitest";

import { deriveRepoSwitchDisplayState } from "@/hooks/use-repo-switch-query-state";

describe("deriveRepoSwitchDisplayState", () => {
  it("masks stale repo data while the next repo is fetching", () => {
    const state = deriveRepoSwitchDisplayState({
      data: ["stale-row"],
      error: null,
      fetchStatus: "fetching",
      isFetched: true,
      isLoading: false,
      isSwitching: true,
    });

    expect(state.data).toBeUndefined();
    expect(state.isLoading).toBe(true);
  });

  it("keeps current data visible once the new repo query settles", () => {
    const state = deriveRepoSwitchDisplayState({
      data: ["fresh-row"],
      error: null,
      fetchStatus: "idle",
      isFetched: true,
      isLoading: false,
      isSwitching: true,
    });

    expect(state.data).toEqual(["fresh-row"]);
    expect(state.isLoading).toBe(false);
  });

  it("releases errors once the new repo query finishes", () => {
    const state = deriveRepoSwitchDisplayState({
      data: undefined,
      error: new Error("load failed"),
      fetchStatus: "idle",
      isFetched: false,
      isLoading: false,
      isSwitching: true,
    });

    expect(state.data).toBeUndefined();
    expect(state.isLoading).toBe(false);
  });
});
