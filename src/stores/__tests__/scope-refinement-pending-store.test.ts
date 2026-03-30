import { beforeEach, describe, expect, it } from "vitest";
import {
  useScopeRefinementPendingStore,
  selectIsPending,
} from "@/stores/scope-refinement-pending-store";

describe("scope-refinement-pending store", () => {
  beforeEach(() => {
    useScopeRefinementPendingStore.setState({
      pendingBeatIds: new Set(),
    });
  });

  it("starts with no pending beat ids", () => {
    const { pendingBeatIds } =
      useScopeRefinementPendingStore.getState();
    expect(pendingBeatIds.size).toBe(0);
  });

  it("markPending adds a beat id", () => {
    const store =
      useScopeRefinementPendingStore.getState();
    store.markPending("beat-1");

    const { pendingBeatIds } =
      useScopeRefinementPendingStore.getState();
    expect(pendingBeatIds.has("beat-1")).toBe(true);
  });

  it("markPending is idempotent", () => {
    const store =
      useScopeRefinementPendingStore.getState();
    store.markPending("beat-1");

    const before =
      useScopeRefinementPendingStore.getState();
    store.markPending("beat-1");
    const after =
      useScopeRefinementPendingStore.getState();

    expect(after).toBe(before);
  });

  it("markComplete removes a beat id", () => {
    const store =
      useScopeRefinementPendingStore.getState();
    store.markPending("beat-1");
    store.markComplete("beat-1");

    const { pendingBeatIds } =
      useScopeRefinementPendingStore.getState();
    expect(pendingBeatIds.has("beat-1")).toBe(false);
  });

  it("markComplete is a no-op for unknown ids", () => {
    const before =
      useScopeRefinementPendingStore.getState();
    before.markComplete("nonexistent");
    const after =
      useScopeRefinementPendingStore.getState();

    expect(after).toBe(before);
  });

  it("tracks multiple beat ids independently", () => {
    const store =
      useScopeRefinementPendingStore.getState();
    store.markPending("beat-1");
    store.markPending("beat-2");
    store.markComplete("beat-1");

    const { pendingBeatIds } =
      useScopeRefinementPendingStore.getState();
    expect(pendingBeatIds.has("beat-1")).toBe(false);
    expect(pendingBeatIds.has("beat-2")).toBe(true);
  });

  it("selectIsPending returns correct boolean", () => {
    const store =
      useScopeRefinementPendingStore.getState();
    store.markPending("beat-1");

    const state =
      useScopeRefinementPendingStore.getState();
    expect(selectIsPending("beat-1")(state)).toBe(
      true,
    );
    expect(selectIsPending("beat-2")(state)).toBe(
      false,
    );
  });
});
