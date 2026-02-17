import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BdResult } from "@/lib/types";
import type { Bead } from "@/lib/types";

import {
  withErrorSuppression,
  DEGRADED_ERROR_MESSAGE,
  _resetCaches,
  _internals,
} from "@/lib/bd-error-suppression";

function ok(data: Bead[]): BdResult<Bead[]> {
  return { ok: true, data };
}

function fail(error: string): BdResult<Bead[]> {
  return { ok: false, error };
}

const STUB_BEAD = {
  id: "b-1",
  title: "stub",
  type: "task",
  status: "open",
  priority: 2,
  labels: [],
  created: "2024-01-01",
  updated: "2024-01-01",
} as Bead;

describe("bd-error-suppression", () => {
  beforeEach(() => {
    _resetCaches();
    vi.restoreAllMocks();
  });

  it("passes through successful results and caches them", () => {
    const result = ok([STUB_BEAD]);
    const out = withErrorSuppression("listBeads", result);

    expect(out).toEqual(result);
    expect(_internals.resultCache.size).toBe(1);
  });

  it("returns original error when no cache exists", () => {
    const result = fail("bd list failed");
    const out = withErrorSuppression("listBeads", result);

    expect(out).toEqual(result);
  });

  it("returns cached data on first failure after a success", () => {
    const success = ok([STUB_BEAD]);
    withErrorSuppression("listBeads", success);

    const failure = fail("database locked");
    const out = withErrorSuppression("listBeads", failure);

    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);
    expect(_internals.failureState.size).toBe(1);
  });

  it("keeps returning cached data within suppression window", () => {
    const success = ok([STUB_BEAD]);
    withErrorSuppression("listBeads", success);

    // First failure
    withErrorSuppression("listBeads", fail("locked"));

    // Subsequent failure still within window
    const out = withErrorSuppression("listBeads", fail("locked again"));
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);
  });

  it("returns degraded error after suppression window expires", () => {
    const success = ok([STUB_BEAD]);
    withErrorSuppression("listBeads", success);

    // First failure -- sets firstFailedAt
    withErrorSuppression("listBeads", fail("locked"));

    // Fast-forward past the suppression window
    const state = _internals.failureState.get(
      Array.from(_internals.failureState.keys())[0]
    )!;
    state.firstFailedAt = Date.now() - 3 * 60 * 1000; // 3 minutes ago

    const out = withErrorSuppression("listBeads", fail("locked"));
    expect(out.ok).toBe(false);
    expect(out.error).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("clears failure state on recovery", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    withErrorSuppression("listBeads", fail("locked"));
    expect(_internals.failureState.size).toBe(1);

    // Recovery
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    expect(_internals.failureState.size).toBe(0);
  });

  it("uses separate cache entries for different call signatures", () => {
    const beadA = { ...STUB_BEAD, id: "a" } as Bead;
    const beadB = { ...STUB_BEAD, id: "b" } as Bead;

    withErrorSuppression("listBeads", ok([beadA]), undefined, "/repo-a");
    withErrorSuppression("listBeads", ok([beadB]), undefined, "/repo-b");

    // Fail repo-a, should get cached beadA
    const outA = withErrorSuppression(
      "listBeads",
      fail("locked"),
      undefined,
      "/repo-a",
    );
    expect(outA.ok).toBe(true);
    expect(outA.data).toEqual([beadA]);

    // repo-b still succeeding
    const freshB = ok([{ ...beadB, title: "fresh" } as Bead]);
    const outB = withErrorSuppression(
      "listBeads",
      freshB,
      undefined,
      "/repo-b",
    );
    expect(outB.ok).toBe(true);
    expect(outB.data?.[0].title).toBe("fresh");
  });

  it("distinguishes searchBeads calls by query parameter", () => {
    withErrorSuppression("searchBeads", ok([STUB_BEAD]), undefined, undefined, "alpha");
    withErrorSuppression("searchBeads", ok([]), undefined, undefined, "beta");

    const out = withErrorSuppression(
      "searchBeads",
      fail("locked"),
      undefined,
      undefined,
      "alpha",
    );
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);

    // beta cache returns empty array
    const outBeta = withErrorSuppression(
      "searchBeads",
      fail("locked"),
      undefined,
      undefined,
      "beta",
    );
    expect(outBeta.ok).toBe(true);
    expect(outBeta.data).toEqual([]);
  });
});
