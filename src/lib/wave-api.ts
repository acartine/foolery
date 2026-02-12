import type { WavePlan, BdResult } from "./types";

export async function fetchWavePlan(repo?: string): Promise<BdResult<WavePlan>> {
  const qs = repo ? `?_repo=${encodeURIComponent(repo)}` : "";
  const res = await fetch(`/api/waves${qs}`);
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json.error ?? "Failed to fetch wave plan" };
  return { ok: true, data: json.data };
}
