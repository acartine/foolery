import type {
  Bead,
  BeadDependency,
  BeadWithRepo,
  BdResult,
  MemoryWorkflowDescriptor,
  RegisteredRepo,
} from "./types";
import type {
  CreateBeadInput,
  UpdateBeadInput,
  CloseBeadInput,
  QueryBeadInput,
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

export function fetchBeads(
  params?: Record<string, string>,
  repo?: string
): Promise<BdResult<Bead[]>> {
  const qs = buildQs(params, repo);
  return request<Bead[]>(`${BASE}${qs}`);
}

export function fetchReadyBeads(
  params?: Record<string, string>,
  repo?: string
): Promise<BdResult<Bead[]>> {
  const qs = buildQs(params, repo);
  return request<Bead[]>(`${BASE}/ready${qs}`);
}

export function queryBeads(
  input: QueryBeadInput,
  repo?: string
): Promise<BdResult<Bead[]>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<Bead[]>(`${BASE}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchBead(
  id: string,
  repo?: string
): Promise<BdResult<Bead>> {
  const qs = repoQs(repo);
  return request<Bead>(`${BASE}/${id}${qs}`);
}

export function createBead(
  input: CreateBeadInput,
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

export function updateBead(
  id: string,
  input: UpdateBeadInput,
  repo?: string
): Promise<BdResult<void>> {
  const body = repo ? { ...input, _repo: repo } : input;
  return request<void>(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteBead(
  id: string,
  repo?: string
): Promise<BdResult<void>> {
  const qs = repoQs(repo);
  return request<void>(`${BASE}/${id}${qs}`, { method: "DELETE" });
}

export function closeBead(
  id: string,
  input: CloseBeadInput,
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
 * Close a parent bead and all its open descendants recursively.
 */
export function cascadeCloseBead(
  id: string,
  input: CloseBeadInput,
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
): Promise<BdResult<BeadDependency[]>> {
  const qs = repoQs(repo);
  return request<BeadDependency[]>(`${BASE}/${id}/deps${qs}`);
}

export function fetchBatchDeps(
  ids: string[],
  repo?: string
): Promise<BdResult<Record<string, BeadDependency[]>>> {
  const qs = buildQs({ ids: ids.join(",") }, repo);
  return request<Record<string, BeadDependency[]>>(
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

export function mergeBeads(
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

export async function fetchBeadsFromAllRepos(
  repos: RegisteredRepo[],
  params?: Record<string, string>
): Promise<BdResult<BeadWithRepo[]>> {
  const results = await Promise.all(
    repos.map(async (repo) => {
      const result = await fetchBeads(params, repo.path);
      if (!result.ok || !result.data) return [];
      return result.data.map((bead) => ({
        ...bead,
        _repoPath: repo.path,
        _repoName: repo.name,
      }));
    })
  );
  return { ok: true, data: results.flat() };
}
