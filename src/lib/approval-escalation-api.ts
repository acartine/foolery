import type { ApprovalEscalation } from "@/lib/approval-escalations";
import { withClientPerfSpan } from "@/lib/client-perf";

const BASE = "/api/approvals";

export interface ApprovalEscalationFilter {
  active?: boolean;
  repoPath?: string;
  updatedSince?: number;
}

export type ApprovalEscalationDtoClient = ApprovalEscalation & {
  actionable?: boolean;
  actionableReason?: string;
  agent?: {
    provider?: string;
    name?: string;
    model?: string;
    version?: string;
  };
};

export async function fetchApprovalEscalations(
  filter: ApprovalEscalationFilter = {},
): Promise<ApprovalEscalationDtoClient[]> {
  return withClientPerfSpan("api", BASE, async () => {
    const url = buildListUrl(filter);
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : [];
    } catch {
      return [];
    }
  }, () => ({ method: "GET", meta: { ...filter } }));
}

function buildListUrl(filter: ApprovalEscalationFilter): string {
  const params = new URLSearchParams();
  if (filter.active) params.set("active", "true");
  if (filter.repoPath) params.set("_repo", filter.repoPath);
  if (filter.updatedSince !== undefined) {
    params.set("updatedSince", String(filter.updatedSince));
  }
  const qs = params.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}
