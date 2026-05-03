import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  useScopeRefinementPendingStore,
} from "@/stores/scope-refinement-pending-store";
import {
  filterNewCompletions,
} from "@/hooks/use-scope-refinement-notifications";
import type {
  ScopeRefinementCompletion,
} from "@/lib/types";

/**
 * Integration test proving the notification hook's
 * completion pipeline clears pending state in the
 * store — covering acceptance criteria 4 & 5.
 *
 * The source-grep assertion that the hook wires `markComplete` for
 * each `beatId` lives in the matching manual test file under
 * `__manual_tests__/` because it requires a real fs read.
 */

function makeCompletion(
  overrides: Partial<ScopeRefinementCompletion> = {},
): ScopeRefinementCompletion {
  return {
    id: "comp-1",
    beatId: "beat-1",
    beatTitle: "Test beat",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("scope refinement pending integration", () => {
  beforeEach(() => {
    useScopeRefinementPendingStore.setState({
      pendingBeatIds: new Set(),
    });
  });

  it("clears pending state when completions arrive for pending beats", () => {
    const store =
      useScopeRefinementPendingStore.getState();

    // Simulate: user clicked Refine Scope
    store.markPending("beat-1");
    store.markPending("beat-2");

    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.has("beat-1"),
    ).toBe(true);
    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.has("beat-2"),
    ).toBe(true);

    // Simulate: poll returns completions
    const seenIds = new Set<string>();
    const mountedAt = 1000;
    const completions = [
      makeCompletion({
        id: "c1",
        beatId: "beat-1",
        timestamp: 2000,
      }),
    ];

    const { beatIds } = filterNewCompletions(
      completions,
      seenIds,
      mountedAt,
    );

    // Simulate: hook calls markComplete for each
    const { markComplete } =
      useScopeRefinementPendingStore.getState();
    for (const beatId of beatIds) {
      markComplete(beatId);
    }

    // beat-1 is no longer pending (re-enabled)
    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.has("beat-1"),
    ).toBe(false);

    // beat-2 is still pending (not yet completed)
    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.has("beat-2"),
    ).toBe(true);
  });

  it("markPending then markComplete round-trips to non-pending", () => {
    const store =
      useScopeRefinementPendingStore.getState();

    store.markPending("beat-x");
    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.has("beat-x"),
    ).toBe(true);

    store.markComplete("beat-x");
    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.has("beat-x"),
    ).toBe(false);
    expect(
      useScopeRefinementPendingStore
        .getState()
        .pendingBeatIds.size,
    ).toBe(0);
  });
});
