import type {
  Beat,
  BeatDependency,
  BdResult,
  MemoryWorkflowDescriptor,
  RegisteredRepo,
  ScopeRefinementStatus,
} from "./types";
import type {
  CreateBeatInput,
  UpdateBeatInput,
  CloseBeatInput,
  QueryBeatInput,
  AddDepInput,
} from "./schemas";
import type { CascadeDescendant } from "./cascade-close";
import type { RepoBeatsChunk } from "./beats-multi-repo";
import { consumeNdjsonStream } from "./ndjson-stream";
import { withClientPerfSpan } from "@/lib/client-perf";

const BASE = "/api/beats";
const ALL_SCOPE = "all";

export interface BeatsScope {
  kind: "repo" | "all" | "default";
  key: string;
  repo?: string;
}

async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<BdResult<T>> {
  return withClientPerfSpan("api", url, async () => {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: typeof json.error === "string"
          ? json.error
          : "Request failed",
      };
    }
    const { data, ...rest } = json;
    delete rest.error;
    return { ok: true, data: (data ?? json) as T, ...rest };
  }, (_result, error) => ({
    method: options?.method ?? "GET",
    meta: { url },
    ...(error ? { ok: false } : {}),
  }));
}

function buildQs(
  params?: Record<string, string>,
  repo?: string
): string {
  const allParams = { ...params };
  if (repo) allParams._repo = repo;
  return Object.keys(allParams).length
    ? "?" + new URLSearchParams(allParams).toString()
    : "";
}

function repoQs(repo?: string): string {
  return repo
    ? "?" + new URLSearchParams({ _repo: repo }).toString()
    : "";
}

export function fetchBeats(
  params?: Record<string, string>,
  repo?: string
): Promise<BdResult<Beat[]>> {
  const qs = buildQs(params, repo);
  return request<Beat[]>(`${BASE}${qs}`);
}

export function resolveBeatsScope(
  activeRepo: string | null | undefined,
  registeredRepos: RegisteredRepo[],
): BeatsScope {
  if (activeRepo) {
    return { kind: "repo", key: `repo:${activeRepo}`, repo: activeRepo };
  }
  if (registeredRepos.length > 0) {
    return {
      kind: "all",
      key: `all:${registeredRepos
        .map((repo) => repo.path)
        .sort()
        .join("|")}`,
    };
  }
  return { kind: "default", key: "default" };
}

export function serializeQueryParams(
  params?: Record<string, string>,
): string {
  if (!params) return "";
  return JSON.stringify(params, Object.keys(params).sort());
}

export function buildBeatsQueryKey(
  view: string,
  params: Record<string, string>,
  scope: BeatsScope,
): readonly unknown[] {
  return ["beats", view, scope.key, serializeQueryParams(params)] as const;
}

function annotateRepoBeats(
  beats: Beat[],
  repoPath: string,
  registeredRepos: RegisteredRepo[],
): Beat[] {
  const repo = registeredRepos.find((candidate) => candidate.path === repoPath);
  return beats.map((beat) => ({
    ...beat,
    _repoPath: repoPath,
    _repoName: repo?.name ?? repoPath,
    _memoryManagerType: repo?.memoryManagerType,
  })) as Beat[];
}

export async function fetchBeatsForScope(
  params: Record<string, string>,
  scope: BeatsScope,
  registeredRepos: RegisteredRepo[],
): Promise<BdResult<Beat[]>> {
  if (scope.kind === "repo" && scope.repo) {
    const result = await fetchBeats(params, scope.repo);
    if (result.ok && result.data) {
      result.data = annotateRepoBeats(
        result.data,
        scope.repo,
        registeredRepos,
      );
    }
    return result;
  }

  if (scope.kind === "all") {
    return request<Beat[]>(
      `${BASE}${buildQs({ ...params, scope: ALL_SCOPE })}`,
    );
  }

  return fetchBeats(params);
}

export interface StreamingBeatsCallbacks {
  /** Called when a repo's beats arrive. */
  onRepoChunk: (
    repo: string,
    repoName: string,
    beats: Beat[],
  ) => void;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Fetch beats for `scope=all` using NDJSON streaming.
 * Calls `onRepoChunk` as each repo responds, then returns the
 * final aggregated result.
 */
export async function fetchBeatsForScopeStreaming(
  params: Record<string, string>,
  scope: BeatsScope,
  callbacks: StreamingBeatsCallbacks,
): Promise<BdResult<Beat[]> & { _degraded?: string }> {
  const url =
    `${BASE}${buildQs({ ...params, scope: ALL_SCOPE })}`;
  const res = await fetch(url, {
    headers: { Accept: "application/x-ndjson" },
    signal: callbacks.signal,
  });
  if (!res.ok || !res.body) {
    const json = await res.json() as Record<string, unknown>;
    return {
      ok: false,
      error: typeof json.error === "string"
        ? json.error : "Request failed",
    };
  }

  let degraded: string | undefined;
  const allBeats: Beat[] = [];

  await consumeNdjsonStream<RepoBeatsChunk>(res.body, {
    signal: callbacks.signal,
    onLine: (chunk) => {
      if (chunk.done) {
        degraded = chunk._degraded;
        return;
      }
      allBeats.push(...chunk.beats);
      callbacks.onRepoChunk(
        chunk.repo, chunk.repoName, chunk.beats,
      );
    },
  });

  return { ok: true, data: allBeats, _degraded: degraded };
}


export function fetchReadyBeats(
  params?: Record<string, string>,
  repo?: string
): Promise<BdResult<Beat[]>> {
  const qs = buildQs(params, repo);
  return request<Beat[]>(`${BASE}/ready${qs}`);
}


export function queryBeats(
  input: QueryBeatInput,
  repo?: string
): Promise<BdResult<Beat[]>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<Beat[]>(`${BASE}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


export function fetchBeat(
  id: string,
  repo?: string
): Promise<BdResult<Beat>> {
  const qs = repoQs(repo);
  return request<Beat>(`${BASE}/${id}${qs}`);
}


export function createBeat(
  input: CreateBeatInput,
  repo?: string
): Promise<BdResult<{ id: string }>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<{ id: string }>(BASE, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


export function fetchWorkflows(
  repo?: string
): Promise<BdResult<MemoryWorkflowDescriptor[]>> {
  const qs = repoQs(repo);
  return request<MemoryWorkflowDescriptor[]>(`/api/workflows${qs}`);
}

export function fetchScopeRefinementStatus(): Promise<BdResult<ScopeRefinementStatus>> {
  return request<ScopeRefinementStatus>("/api/scope-refinement/status");
}

export function updateBeat(
  id: string,
  input: UpdateBeatInput,
  repo?: string
): Promise<BdResult<void>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<void>(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}


export function deleteBeat(
  id: string,
  repo?: string
): Promise<BdResult<void>> {
  const qs = repoQs(repo);
  return request<void>(`${BASE}/${id}${qs}`, { method: "DELETE" });
}


export function closeBeat(
  id: string,
  input: CloseBeatInput,
  repo?: string
): Promise<BdResult<void>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<void>(`${BASE}/${id}/close`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


/**
 * Preview which descendants would be closed if a cascade close is performed.
 */
export function previewCascadeClose(
  id: string,
  repo?: string
): Promise<BdResult<{ descendants: CascadeDescendant[] }>> {
  const body: Record<string, unknown> = { confirmed: false };
  if (repo) body._repo = repo;
  return request<{ descendants: CascadeDescendant[] }>(`${BASE}/${id}/close-cascade`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Close a parent beat and all its open descendants recursively.
 */
export function cascadeCloseBeat(
  id: string,
  input: CloseBeatInput,
  repo?: string
): Promise<BdResult<{ closed: string[]; errors: string[] }>> {
  const body: Record<string, unknown> = { ...input, confirmed: true };
  if (repo) body._repo = repo;
  return request<{ closed: string[]; errors: string[] }>(`${BASE}/${id}/close-cascade`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


export function fetchDeps(
  id: string,
  repo?: string
): Promise<BdResult<BeatDependency[]>> {
  const qs = repoQs(repo);
  return request<BeatDependency[]>(`${BASE}/${id}/deps${qs}`);
}

export function fetchBatchDeps(
  ids: string[],
  repo?: string
): Promise<BdResult<Record<string, BeatDependency[]>>> {
  const qs = buildQs({ ids: ids.join(",") }, repo);
  return request<Record<string, BeatDependency[]>>(
    `${BASE}/batch-deps${qs}`
  );
}

export function addDep(
  id: string,
  input: AddDepInput,
  repo?: string
): Promise<BdResult<void>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<void>(`${BASE}/${id}/deps`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function refineBeatScope(
  id: string,
  repo?: string
): Promise<BdResult<{ jobId: string; beatId: string }>> {
  const body: Record<string, string> = {};
  if (repo) body._repo = repo;
  return request<{ jobId: string; beatId: string }>(
    `${BASE}/${id}/refine-scope`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function mergeBeats(
  survivorId: string,
  consumedId: string,
  repo?: string
): Promise<BdResult<{ survivorId: string; consumedId: string }>> {
  const body: Record<string, string> = { survivorId, consumedId };
  if (repo) body._repo = repo;
  return request<{ survivorId: string; consumedId: string }>(`${BASE}/merge`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


export async function fetchBeatsFromAllRepos(
  repos: RegisteredRepo[],
  params?: Record<string, string>
): Promise<BdResult<Beat[]>> {
  const scope = resolveBeatsScope(null, repos);
  return fetchBeatsForScope(params ?? {}, scope, repos);
}
