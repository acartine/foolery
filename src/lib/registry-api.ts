import type { RegisteredRepo, DirEntry, BdResult } from "./types";

const BASE = "/api/registry";

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

export function fetchRegistry(): Promise<BdResult<RegisteredRepo[]>> {
  return request<RegisteredRepo[]>(BASE);
}

export function addRepoToRegistry(
  path: string
): Promise<BdResult<RegisteredRepo>> {
  return request<RegisteredRepo>(BASE, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function removeRepoFromRegistry(
  path: string
): Promise<BdResult<void>> {
  return request<void>(BASE, {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

export function browseDirectory(
  path?: string
): Promise<BdResult<DirEntry[]>> {
  const qs = path
    ? "?" + new URLSearchParams({ path }).toString()
    : "";
  return request<DirEntry[]>(`${BASE}/browse${qs}`);
}
