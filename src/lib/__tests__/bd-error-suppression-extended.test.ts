import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Beat } from "@/lib/types";
import type { BackendResult } from "@/lib/backend-port";

import {
  withErrorSuppression,
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

describe("bd-error-suppression cache TTL expiry", () => {
  beforeEach(() => {
    _resetCaches();
    vi.restoreAllMocks();
  });

  it("evicts expired cache entry and cleans up failure state (lines 122-125)", () => {
    // Populate cache with a successful result
    withErrorSuppression("listBeads", ok([STUB_BEAT]));

    // Start a failure tracking
    withErrorSuppression("listBeads", fail("locked"));
    expect(_internals.failureState.size).toBe(1);

    // Expire the cache entry past TTL (10 min) but keep failure within
    // suppression window (2 min)
    const cacheKey = Array.from(_internals.resultCache.keys())[0];
    _internals.resultCache.get(cacheKey)!.timestamp =
      Date.now() - 11 * 60 * 1000;

    // Reset failure state to be recent so we don't hit the degraded path
    const failKey = Array.from(_internals.failureState.keys())[0];
    _internals.failureState.get(failKey)!.firstFailedAt = Date.now();

    // Now a lock error should hit the TTL check (lines 122-125):
    // cache entry is expired, so it gets evicted and the raw error is returned
    const out = withErrorSuppression("listBeads", fail("locked"));
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe("locked");

    // Cache and failure state should be cleaned up
    expect(_internals.resultCache.has(cacheKey)).toBe(false);
    expect(_internals.failureState.has(failKey)).toBe(false);
  });

  it("_internals SUPPRESSION_WINDOW_MS getter returns expected value", () => {
    // Line 149: exercises the getter for SUPPRESSION_WINDOW_MS
    expect(_internals.SUPPRESSION_WINDOW_MS).toBe(2 * 60 * 1000);
  });

  it("_internals MAX_CACHE_ENTRIES getter returns expected value", () => {
    expect(_internals.MAX_CACHE_ENTRIES).toBe(64);
  });

  it("_internals exposes resultCache and failureState maps", () => {
    expect(_internals.resultCache).toBeInstanceOf(Map);
    expect(_internals.failureState).toBeInstanceOf(Map);
  });
});
