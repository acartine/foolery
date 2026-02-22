import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BdResult, Bead } from "@/lib/types";

import {
  withErrorSuppression,
  isSuppressibleError,
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

  it("returns degraded error when no cache exists for lock errors", () => {
    const result = fail("database is locked");
    const out = withErrorSuppression("listBeads", result);
    expect(out.ok).toBe(false);
    expect(out.error).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("returns cached data on first lock failure after a success", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    const out = withErrorSuppression("listBeads", fail("database locked"));
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);
    expect(_internals.failureState.size).toBe(1);
  });

  it("keeps returning cached data within suppression window", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    withErrorSuppression("listBeads", fail("locked"));
    const out = withErrorSuppression("listBeads", fail("locked again"));
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);
  });

  it("returns degraded error after suppression window expires", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    withErrorSuppression("listBeads", fail("locked"));

    const state = _internals.failureState.get(
      Array.from(_internals.failureState.keys())[0]
    )!;
    state.firstFailedAt = Date.now() - 3 * 60 * 1000;

    const out = withErrorSuppression("listBeads", fail("locked"));
    expect(out.ok).toBe(false);
    expect(out.error).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("clears failure state on recovery", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    withErrorSuppression("listBeads", fail("locked"));
    expect(_internals.failureState.size).toBe(1);

    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    expect(_internals.failureState.size).toBe(0);
  });

  it("uses separate cache entries for different call signatures", () => {
    const beadA = { ...STUB_BEAD, id: "a" } as Bead;
    const beadB = { ...STUB_BEAD, id: "b" } as Bead;

    withErrorSuppression("listBeads", ok([beadA]), undefined, "/repo-a");
    withErrorSuppression("listBeads", ok([beadB]), undefined, "/repo-b");

    const outA = withErrorSuppression("listBeads", fail("locked"), undefined, "/repo-a");
    expect(outA.ok).toBe(true);
    expect(outA.data).toEqual([beadA]);

    const freshB = ok([{ ...beadB, title: "fresh" } as Bead]);
    const outB = withErrorSuppression("listBeads", freshB, undefined, "/repo-b");
    expect(outB.ok).toBe(true);
    expect(outB.data?.[0].title).toBe("fresh");
  });

  it("distinguishes searchBeads calls by query parameter", () => {
    withErrorSuppression("searchBeads", ok([STUB_BEAD]), undefined, undefined, "alpha");
    withErrorSuppression("searchBeads", ok([]), undefined, undefined, "beta");

    const out = withErrorSuppression("searchBeads", fail("locked"), undefined, undefined, "alpha");
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);

    const outBeta = withErrorSuppression("searchBeads", fail("locked"), undefined, undefined, "beta");
    expect(outBeta.ok).toBe(true);
    expect(outBeta.data).toEqual([]);
  });

  it("does NOT suppress non-lock errors like parse failures", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    const out = withErrorSuppression("listBeads", fail("Failed to parse bd list output"));
    expect(out.ok).toBe(false);
    expect(out.error).toBe("Failed to parse bd list output");
  });

  it("does NOT suppress generic bd failures", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    const out = withErrorSuppression("listBeads", fail("bd list failed"));
    expect(out.ok).toBe(false);
    expect(out.error).toBe("bd list failed");
  });

  it("evicts oldest entry when cache exceeds MAX_CACHE_ENTRIES", () => {
    const max = _internals.MAX_CACHE_ENTRIES;
    for (let i = 0; i <= max; i++) {
      withErrorSuppression("listBeads", ok([STUB_BEAD]), undefined, `/repo-${i}`);
    }
    // Should have evicted the first entry, keeping size at max
    expect(_internals.resultCache.size).toBe(max);
  });

  it("returns degraded error when cache TTL expires during ongoing failure", () => {
    withErrorSuppression("listBeads", ok([STUB_BEAD]));
    withErrorSuppression("listBeads", fail("locked"));

    // Fast-forward failure past suppression window
    const failKey = Array.from(_internals.failureState.keys())[0];
    _internals.failureState.get(failKey)!.firstFailedAt = Date.now() - 3 * 60 * 1000;

    // Also expire the cache entry past TTL
    const cacheKey = Array.from(_internals.resultCache.keys())[0];
    _internals.resultCache.get(cacheKey)!.timestamp = Date.now() - 11 * 60 * 1000;

    // First request after TTL -- should still return degraded
    const out1 = withErrorSuppression("listBeads", fail("locked"));
    expect(out1.ok).toBe(false);
    expect(out1.error).toBe(DEGRADED_ERROR_MESSAGE);

    // Subsequent request with no cache -- should still return degraded
    const out2 = withErrorSuppression("listBeads", fail("locked"));
    expect(out2.ok).toBe(false);
    expect(out2.error).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("produces same cache key regardless of filter key order", () => {
    const filtersA = { status: "open", type: "bug" };
    const filtersB = { type: "bug", status: "open" };

    withErrorSuppression("listBeads", ok([STUB_BEAD]), filtersA);
    const out = withErrorSuppression("listBeads", fail("locked"), filtersB);
    // Should hit the cache from filtersA since keys are the same
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAD]);
  });
});

describe("isSuppressibleError", () => {
  it("matches lock-related error messages", () => {
    expect(isSuppressibleError("database is locked")).toBe(true);
    expect(isSuppressibleError("could not obtain lock on table")).toBe(true);
    expect(isSuppressibleError("Timed out waiting for bd repo lock for /repo after 15000ms")).toBe(true);
    expect(isSuppressibleError("bd command timed out after 15000ms")).toBe(true);
    expect(isSuppressibleError("Error: EACCES permission denied")).toBe(true);
    expect(isSuppressibleError("resource busy")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isSuppressibleError("Failed to parse bd list output")).toBe(false);
    expect(isSuppressibleError("bd list failed")).toBe(false);
    expect(isSuppressibleError("unknown command")).toBe(false);
  });
});
