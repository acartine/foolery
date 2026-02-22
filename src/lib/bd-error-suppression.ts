import type { Bead, BdResult } from "./types";

/**
 * Error-suppression cache for bd list/ready/search operations.
 *
 * When a bd CLI command fails due to a lock/access error (e.g. dolt locked by
 * another client), this layer:
 *  1. Returns the last successful result silently for up to 2 minutes.
 *  2. After 2 minutes of continuous failure, returns a degraded error.
 *  3. On recovery (next success), clears failure tracking and updates cache.
 *
 * Non-lock errors (parse failures, unknown errors) are passed through
 * immediately and never suppressed.
 */

interface CacheEntry {
  data: BdResult<Bead[]>;
  timestamp: number;
}

interface FailureState {
  firstFailedAt: number;
}

const SUPPRESSION_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const MAX_CACHE_ENTRIES = 64;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const DEGRADED_ERROR_MESSAGE =
  "Unable to interact with beads store, try refreshing the page or restarting Foolery. If problems persist, investigate your beads install";

/** Error substrings that indicate a lock/access issue worth suppressing. */
const SUPPRESSIBLE_PATTERNS = [
  "lock",
  "locked",
  "timed out waiting for bd repo lock",
  "bd command timed out",
  "database is locked",
  "unable to open database",
  "could not obtain lock",
  "busy",
  "eacces",
  "permission denied",
];

const resultCache = new Map<string, CacheEntry>();
const failureState = new Map<string, FailureState>();

function cacheKey(
  fn: string,
  filters?: Record<string, string>,
  repoPath?: string,
  query?: string,
): string {
  // Sort filter keys so equivalent sets with different key order produce the
  // same cache key, improving hit rate.
  const sorted = filters
    ? JSON.stringify(filters, Object.keys(filters).sort())
    : "{}";
  return `${fn}:${query ?? ""}:${sorted}:${repoPath ?? ""}`;
}

/** Returns true if the error message looks like a lock/access issue. */
export function isSuppressibleError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase();
  return SUPPRESSIBLE_PATTERNS.some((p) => lower.includes(p));
}

/** Evict the oldest entry when the cache exceeds MAX_CACHE_ENTRIES. */
function evictIfNeeded(): void {
  if (resultCache.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | undefined;
  let oldestTs = Infinity;
  for (const [key, entry] of resultCache) {
    if (entry.timestamp < oldestTs) {
      oldestTs = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    resultCache.delete(oldestKey);
    failureState.delete(oldestKey);
  }
}

/**
 * Wrap a BdResult from a list-type operation with error suppression.
 * Call this with the raw result from listBeads/readyBeads/searchBeads.
 */
export function withErrorSuppression(
  fn: string,
  result: BdResult<Bead[]>,
  filters?: Record<string, string>,
  repoPath?: string,
  query?: string,
): BdResult<Bead[]> {
  const key = cacheKey(fn, filters, repoPath, query);

  if (result.ok) {
    resultCache.set(key, { data: result, timestamp: Date.now() });
    evictIfNeeded();
    failureState.delete(key);
    return result;
  }

  // Only suppress lock/access errors -- pass everything else through
  if (!isSuppressibleError(result.error ?? "")) return result;

  const failure = failureState.get(key);

  // If we're already past the suppression window, stay in degraded mode
  // regardless of whether the cache entry still exists. This ensures
  // consistent degraded behavior even after TTL eviction.
  if (failure && Date.now() - failure.firstFailedAt >= SUPPRESSION_WINDOW_MS) {
    // Clean up the expired cache entry to free memory
    resultCache.delete(key);
    return { ok: false, error: DEGRADED_ERROR_MESSAGE };
  }

  const cached = resultCache.get(key);

  // Evict expired cache entries. Also clean up their failure state to
  // prevent unbounded failureState growth for abandoned keys.
  if (cached && Date.now() - cached.timestamp > CACHE_TTL_MS) {
    resultCache.delete(key);
    failureState.delete(key);
    return result;
  }

  if (!cached) return result; // No cache available -- cannot suppress

  if (!failure) {
    // First failure -- start tracking, return cached result
    failureState.set(key, { firstFailedAt: Date.now() });
    return cached.data;
  }

  // Within suppression window -- serve stale data
  return cached.data;
}

/** Visible for testing -- clears all internal caches. */
export function _resetCaches(): void {
  resultCache.clear();
  failureState.clear();
}

/** Visible for testing -- access internal state. */
export const _internals = {
  get SUPPRESSION_WINDOW_MS() {
    return SUPPRESSION_WINDOW_MS;
  },
  get MAX_CACHE_ENTRIES() {
    return MAX_CACHE_ENTRIES;
  },
  resultCache,
  failureState,
};
