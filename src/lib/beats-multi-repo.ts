import { getBackend } from "@/lib/backend-instance";
import type { BeatListFilters } from "@/lib/backend-port";
import { backendErrorStatus } from "@/lib/backend-http";
import {
  withErrorSuppression,
  DEGRADED_ERROR_MESSAGE,
} from "@/lib/bd-error-suppression";
import type { BdResult, Beat } from "@/lib/types";
import type { RegisteredRepo } from "@/lib/registry";
import { listRepos } from "@/lib/registry";

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 64;

export type AggregateBeatsResult = BdResult<Beat[]> & {
  _degraded?: string;
};

interface AggregateCacheEntry {
  result: AggregateBeatsResult;
  expiresAt: number;
}

type AggregateRequest = {
  filters: BeatListFilters;
  query?: string;
  repos: RegisteredRepo[];
};

const aggregateCache = new Map<string, AggregateCacheEntry>();
const inflight = new Map<string, Promise<AggregateBeatsResult>>();

export async function listBeatsAcrossRegisteredRepos(
  filters: BeatListFilters,
  query?: string,
): Promise<AggregateBeatsResult> {
  const repos = await listRepos();
  return loadAggregate({ filters, query, repos });
}

function buildCacheKey(request: AggregateRequest): string {
  const filterKeys = Object.keys(request.filters).sort();
  const serializedFilters = JSON.stringify(request.filters, filterKeys);
  const repoKey = request.repos.map((repo) => repo.path).sort().join("|");
  return `${request.query ?? ""}:${serializedFilters}:${repoKey}`;
}

function getCachedResult(key: string): AggregateBeatsResult | null {
  const cached = aggregateCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    aggregateCache.delete(key);
    return null;
  }
  return cached.result;
}

function setCachedResult(
  key: string,
  result: AggregateBeatsResult,
): void {
  aggregateCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  evictCacheIfNeeded();
}

function evictCacheIfNeeded(): void {
  while (aggregateCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = aggregateCache.keys().next().value;
    if (!oldestKey) return;
    aggregateCache.delete(oldestKey);
  }
}

async function loadAggregate(
  request: AggregateRequest,
): Promise<AggregateBeatsResult> {
  const key = buildCacheKey(request);
  const cached = getCachedResult(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = loadFreshAggregate(request);
  inflight.set(key, promise);

  try {
    const result = await promise;
    setCachedResult(key, result);
    return result;
  } finally {
    inflight.delete(key);
  }
}

async function loadFreshAggregate(
  request: AggregateRequest,
): Promise<AggregateBeatsResult> {
  if (request.repos.length === 0) {
    return { ok: true, data: [] };
  }

  const errors: string[] = [];
  const results = await Promise.all(
    request.repos.map((repo) => loadRepoBeats(repo, request, errors)),
  );
  const beats = results.flat();

  if (beats.length === 0 && errors.length > 0) {
    return { ok: false, error: errors[0] };
  }

  if (errors.length === 0) {
    return { ok: true, data: beats };
  }

  const degraded = errors.some((message) => message === DEGRADED_ERROR_MESSAGE);
  return {
    ok: true,
    data: beats,
    _degraded: degraded
      ? DEGRADED_ERROR_MESSAGE
      : `Failed to load ${errors.length} repositories; showing partial results.`,
  };
}

async function loadRepoBeats(
  repo: RegisteredRepo,
  request: AggregateRequest,
  errors: string[],
): Promise<Beat[]> {
  const raw = request.query
    ? await getBackend().search(request.query, request.filters, repo.path)
    : await getBackend().list(request.filters, repo.path);
  const fn = request.query ? "searchBeats" : "listBeats";
  const result = withErrorSuppression(
    fn,
    raw,
    request.filters as Record<string, string>,
    repo.path,
    request.query,
  );

  if (!result.ok || !result.data) {
    const message = result.error?.message
      ?? `Failed to load beats for ${repo.path}`;
    errors.push(message);
    return [];
  }

  return result.data.map((beat) => ({
    ...beat,
    _repoPath: repo.path,
    _repoName: repo.name,
    _memoryManagerType: repo.memoryManagerType,
  })) as Beat[];
}

export function aggregateBeatsErrorStatus(error: string): number {
  if (error === DEGRADED_ERROR_MESSAGE) {
    return 503;
  }
  return backendErrorStatus({
    code: "INTERNAL",
    message: error,
    retryable: false,
  });
}

export function _resetAggregateBeatsCache(): void {
  aggregateCache.clear();
  inflight.clear();
}
