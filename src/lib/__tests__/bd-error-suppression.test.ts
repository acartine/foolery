import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Beat } from "@/lib/types";
import type { BackendResult } from "@/lib/backend-port";

import {
  withErrorSuppression,
  isSuppressibleError,
  DEGRADED_ERROR_MESSAGE,
  _resetCaches,
  _internals,
} from "@/lib/bd-error-suppression";

function ok(data: Beat[]): BackendResult<Beat[]> {
  return { ok: true, data };
}

function fail(error: string): BackendResult<Beat[]> {
  return { ok: false, error: { code: "BACKEND_ERROR", message: error, retryable: false } };
}

const STUB_BEAT = {
  id: "b-1",
  title: "stub",
  type: "task",
  state: "open",
  priority: 2,
  labels: [],
  created: "2024-01-01",
  updated: "2024-01-01",
} as Beat;

describe("bd-error-suppression", () => {
  beforeEach(() => {
    _resetCaches();
    vi.restoreAllMocks();
  });

  it("passes through successful results and caches them", () => {
    const result = ok([STUB_BEAT]);
    const out = withErrorSuppression("listBeats", result);
    expect(out).toEqual(result);
    expect(_internals.resultCache.size).toBe(1);
  });

  it("returns degraded error when no cache exists for lock errors", () => {
    const result = fail("database is locked");
    const out = withErrorSuppression("listBeats", result);
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("returns cached data on first lock failure after a success", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    const out = withErrorSuppression("listBeats", fail("database locked"));
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAT]);
    expect(_internals.failureState.size).toBe(1);
  });

  it("keeps returning cached data within suppression window", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    withErrorSuppression("listBeats", fail("locked"));
    const out = withErrorSuppression("listBeats", fail("locked again"));
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAT]);
  });

  it("returns degraded error after suppression window expires", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    withErrorSuppression("listBeats", fail("locked"));

    const state = _internals.failureState.get(
      Array.from(_internals.failureState.keys())[0]
    )!;
    state.firstFailedAt = Date.now() - 3 * 60 * 1000;

    const out = withErrorSuppression("listBeats", fail("locked"));
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("clears failure state on recovery", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    withErrorSuppression("listBeats", fail("locked"));
    expect(_internals.failureState.size).toBe(1);

    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    expect(_internals.failureState.size).toBe(0);
  });

  it("uses separate cache entries for different call signatures", () => {
    const beatA = { ...STUB_BEAT, id: "a" } as Beat;
    const beatB = { ...STUB_BEAT, id: "b" } as Beat;

    withErrorSuppression("listBeats", ok([beatA]), undefined, "/repo-a");
    withErrorSuppression("listBeats", ok([beatB]), undefined, "/repo-b");

    const outA = withErrorSuppression("listBeats", fail("locked"), undefined, "/repo-a");
    expect(outA.ok).toBe(true);
    expect(outA.data).toEqual([beatA]);

    const freshB = ok([{ ...beatB, title: "fresh" } as Beat]);
    const outB = withErrorSuppression("listBeats", freshB, undefined, "/repo-b");
    expect(outB.ok).toBe(true);
    expect(outB.data?.[0].title).toBe("fresh");
  });

  it("distinguishes searchBeats calls by query parameter", () => {
    withErrorSuppression("searchBeats", ok([STUB_BEAT]), undefined, undefined, "alpha");
    withErrorSuppression("searchBeats", ok([]), undefined, undefined, "beta");

    const out = withErrorSuppression("searchBeats", fail("locked"), undefined, undefined, "alpha");
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAT]);

    const outBeta = withErrorSuppression("searchBeats", fail("locked"), undefined, undefined, "beta");
    expect(outBeta.ok).toBe(true);
    expect(outBeta.data).toEqual([]);
  });

  it("does NOT suppress non-lock errors like parse failures", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    const out = withErrorSuppression("listBeats", fail("Failed to parse bd list output"));
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe("Failed to parse bd list output");
  });

  it("does NOT suppress generic bd failures", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    const out = withErrorSuppression("listBeats", fail("bd list failed"));
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe("bd list failed");
  });

  it("evicts oldest entry when cache exceeds MAX_CACHE_ENTRIES", () => {
    const max = _internals.MAX_CACHE_ENTRIES;
    for (let i = 0; i <= max; i++) {
      withErrorSuppression("listBeats", ok([STUB_BEAT]), undefined, `/repo-${i}`);
    }
    // Should have evicted the first entry, keeping size at max
    expect(_internals.resultCache.size).toBe(max);
  });

  it("returns degraded error when cache TTL expires during ongoing failure", () => {
    withErrorSuppression("listBeats", ok([STUB_BEAT]));
    withErrorSuppression("listBeats", fail("locked"));

    // Fast-forward failure past suppression window
    const failKey = Array.from(_internals.failureState.keys())[0];
    _internals.failureState.get(failKey)!.firstFailedAt = Date.now() - 3 * 60 * 1000;

    // Also expire the cache entry past TTL
    const cacheKey = Array.from(_internals.resultCache.keys())[0];
    _internals.resultCache.get(cacheKey)!.timestamp = Date.now() - 11 * 60 * 1000;

    // First request after TTL -- should still return degraded
    const out1 = withErrorSuppression("listBeats", fail("locked"));
    expect(out1.ok).toBe(false);
    expect(out1.error?.message).toBe(DEGRADED_ERROR_MESSAGE);

    // Subsequent request with no cache -- should still return degraded
    const out2 = withErrorSuppression("listBeats", fail("locked"));
    expect(out2.ok).toBe(false);
    expect(out2.error?.message).toBe(DEGRADED_ERROR_MESSAGE);
  });

  it("produces same cache key regardless of filter key order", () => {
    const filtersA = { status: "open", type: "bug" };
    const filtersB = { type: "bug", status: "open" };

    withErrorSuppression("listBeats", ok([STUB_BEAT]), filtersA);
    const out = withErrorSuppression("listBeats", fail("locked"), filtersB);
    // Should hit the cache from filtersA since keys are the same
    expect(out.ok).toBe(true);
    expect(out.data).toEqual([STUB_BEAT]);
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
