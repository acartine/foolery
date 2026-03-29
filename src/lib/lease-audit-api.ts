import type { LeaseAuditEvent, LeaseAuditAggregate } from "@/lib/lease-audit";
import { withClientPerfSpan } from "@/lib/client-perf";

export interface LeaseAuditResponse {
  events: LeaseAuditEvent[];
  aggregates: LeaseAuditAggregate[];
}

export interface LeaseAuditParams {
  repoPath?: string;
  queueType?: string;
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
  preset?: "last24h" | "last7d";
}

export async function fetchLeaseAudit(
  params?: LeaseAuditParams,
): Promise<LeaseAuditResponse> {
  return withClientPerfSpan("api", "/api/lease-audit", async () => {
    const url = new URL("/api/lease-audit", window.location.origin);
    if (params?.repoPath) url.searchParams.set("repoPath", params.repoPath);
    if (params?.queueType) url.searchParams.set("queueType", params.queueType);
    if (params?.agent) url.searchParams.set("agent", params.agent);
    if (params?.dateFrom) url.searchParams.set("dateFrom", params.dateFrom);
    if (params?.dateTo) url.searchParams.set("dateTo", params.dateTo);
    if (params?.preset) url.searchParams.set("preset", params.preset);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ?? "Failed to fetch lease audit data",
      );
    }
    return (await res.json()) as LeaseAuditResponse;
  }, () => ({ method: "GET", meta: { repoPath: params?.repoPath } }));
}

export async function resetLeaseAudit(): Promise<void> {
  await withClientPerfSpan("api", "/api/lease-audit/reset", async () => {
    const res = await fetch("/api/lease-audit", { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ?? "Failed to reset audit data",
      );
    }
  }, () => ({ method: "DELETE" }));
}
