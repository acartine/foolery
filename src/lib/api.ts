import type { Bead, BeadDependency, BdResult } from "./types";
import type {
  CreateBeadInput,
  UpdateBeadInput,
  CloseBeadInput,
  QueryBeadInput,
  AddDepInput,
} from "./schemas";

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

export function fetchBeads(
  params?: Record<string, string>
): Promise<BdResult<Bead[]>> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<Bead[]>(`${BASE}${qs}`);
}

export function fetchReadyBeads(
  params?: Record<string, string>
): Promise<BdResult<Bead[]>> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<Bead[]>(`${BASE}/ready${qs}`);
}

export function queryBeads(input: QueryBeadInput): Promise<BdResult<Bead[]>> {
  return request<Bead[]>(`${BASE}/query`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchBead(id: string): Promise<BdResult<Bead>> {
  return request<Bead>(`${BASE}/${id}`);
}

export function createBead(
  input: CreateBeadInput
): Promise<BdResult<{ id: string }>> {
  return request<{ id: string }>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateBead(
  id: string,
  input: UpdateBeadInput
): Promise<BdResult<void>> {
  return request<void>(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteBead(id: string): Promise<BdResult<void>> {
  return request<void>(`${BASE}/${id}`, { method: "DELETE" });
}

export function closeBead(
  id: string,
  input: CloseBeadInput
): Promise<BdResult<void>> {
  return request<void>(`${BASE}/${id}/close`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchDeps(id: string): Promise<BdResult<BeadDependency[]>> {
  return request<BeadDependency[]>(`${BASE}/${id}/deps`);
}

export function addDep(
  id: string,
  input: AddDepInput
): Promise<BdResult<void>> {
  return request<void>(`${BASE}/${id}/deps`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
