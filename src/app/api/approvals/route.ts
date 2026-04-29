import { NextRequest, NextResponse } from "next/server";
import {
  listApprovals,
  type ApprovalListFilter,
} from "@/lib/approval-registry";
import { withServerTiming } from "@/lib/server-timing";
import type {
  ApprovalEscalationStatus,
} from "@/lib/approval-actions";

const ALLOWED_STATUSES: ReadonlySet<ApprovalEscalationStatus> = new Set([
  "pending",
  "responding",
  "approved",
  "always_approved",
  "rejected",
  "manual_required",
  "dismissed",
  "reply_failed",
  "unsupported",
]);

export function GET(request: NextRequest) {
  return withServerTiming(
    { route: "GET /api/approvals" },
    async ({ measure }) => {
      const filter = parseFilter(request);
      const data = await measure("list", () => listApprovals(filter));
      return NextResponse.json({ data });
    },
  );
}

function parseFilter(request: NextRequest): ApprovalListFilter {
  const params = request.nextUrl.searchParams;
  const filter: ApprovalListFilter = {};
  const repoPath = params.get("_repo");
  if (repoPath) filter.repoPath = repoPath;
  const active = params.get("active");
  if (active === "true") filter.activeOnly = true;
  const statuses = collectStatusParams(params);
  if (statuses.length > 0) filter.status = statuses;
  const updatedSince = params.get("updatedSince");
  if (updatedSince !== null) {
    const parsed = Number.parseInt(updatedSince, 10);
    if (!Number.isNaN(parsed)) filter.updatedSince = parsed;
  }
  return filter;
}

function collectStatusParams(
  params: URLSearchParams,
): ApprovalEscalationStatus[] {
  const out: ApprovalEscalationStatus[] = [];
  const raw = params.getAll("status");
  for (const entry of raw) {
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (ALLOWED_STATUSES.has(trimmed as ApprovalEscalationStatus)) {
        out.push(trimmed as ApprovalEscalationStatus);
      }
    }
  }
  return out;
}
