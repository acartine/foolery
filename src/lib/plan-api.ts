import type { PlanRecord, PlanSummary } from "@/lib/orchestration-plan-types";
import type { BdResult, Beat } from "@/lib/types";

async function request<T>(url: string): Promise<BdResult<T>> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Request failed" };
  }
  return { ok: true, data: json.data ?? json };
}

export function fetchPlanSummaries(
  repoPath: string,
): Promise<BdResult<PlanSummary[]>> {
  const query = new URLSearchParams({ repoPath });
  return request<PlanSummary[]>(`/api/plans?${query.toString()}`);
}

export function fetchPlan(
  planId: string,
  repoPath: string,
): Promise<BdResult<PlanRecord>> {
  const query = new URLSearchParams({ repoPath });
  return request<PlanRecord>(
    `/api/plans/${encodeURIComponent(planId)}?${query.toString()}`,
  );
}

export function fetchRepoBeats(
  repoPath: string,
): Promise<BdResult<Beat[]>> {
  const query = new URLSearchParams({ _repo: repoPath });
  return request<Beat[]>(`/api/beats?${query.toString()}`);
}
