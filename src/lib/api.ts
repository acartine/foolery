import type {
  Beat,
  BeatDependency,
  BeatWithRepo,
  BdResult,
  MemoryWorkflowDescriptor,
  RegisteredRepo,
} from "./types";
import type {
  CreateBeatInput,
  UpdateBeatInput,
  CloseBeatInput,
  QueryBeatInput,
  AddDepInput,
} from "./schemas";
import type { CascadeDescendant } from "./cascade-close";

const BASE = "/api/beads";

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<BdResult<T>> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Request failed" };
  }
  return { ok: true, data: json.data ?? json };
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

/** @deprecated Use fetchBeats */
export const fetchBeads = fetchBeats;

export function fetchReadyBeats(
  params?: Record<string, string>,
  repo?: string
): Promise<BdResult<Beat[]>> {
  const qs = buildQs(params, repo);
  return request<Beat[]>(`${BASE}/ready${qs}`);
}

/** @deprecated Use fetchReadyBeats */
export const fetchReadyBeads = fetchReadyBeats;

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

/** @deprecated Use queryBeats */
export const queryBeads = queryBeats;

export function fetchBeat(
  id: string,
  repo?: string
): Promise<BdResult<Beat>> {
  const qs = repoQs(repo);
  return request<Beat>(`${BASE}/${id}${qs}`);
}

/** @deprecated Use fetchBeat */
export const fetchBead = fetchBeat;

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

/** @deprecated Use createBeat */
export const createBead = createBeat;

export function fetchWorkflows(
  repo?: string
): Promise<BdResult<MemoryWorkflowDescriptor[]>> {
  const qs = repoQs(repo);
  return request<MemoryWorkflowDescriptor[]>(`/api/workflows${qs}`);
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

/** @deprecated Use updateBeat */
export const updateBead = updateBeat;

export function deleteBeat(
  id: string,
  repo?: string
): Promise<BdResult<void>> {
  const qs = repoQs(repo);
  return request<void>(`${BASE}/${id}${qs}`, { method: "DELETE" });
}

/** @deprecated Use deleteBeat */
export const deleteBead = deleteBeat;

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

/** @deprecated Use closeBeat */
export const closeBead = closeBeat;

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

/** @deprecated Use cascadeCloseBeat */
export const cascadeCloseBead = cascadeCloseBeat;

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

/** @deprecated Use mergeBeats */
export const mergeBeads = mergeBeats;

export async function fetchBeatsFromAllRepos(
  repos: RegisteredRepo[],
  params?: Record<string, string>
): Promise<BdResult<BeatWithRepo[]>> {
  const results = await Promise.all(
    repos.map(async (repo) => {
      const result = await fetchBeats(params, repo.path);
      if (!result.ok || !result.data) return [];
      return result.data.map((beat) => ({
        ...beat,
        _repoPath: repo.path,
        _repoName: repo.name,
      }));
    })
  );
  return { ok: true, data: results.flat() };
}

/** @deprecated Use fetchBeatsFromAllRepos */
export const fetchBeadsFromAllRepos = fetchBeatsFromAllRepos;
