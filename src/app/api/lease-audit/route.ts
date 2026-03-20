import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  readLeaseAuditEvents,
  aggregateLeaseAudit,
  resolveAuditLogRoots,
} from "@/lib/lease-audit";
import type { LeaseAuditEvent } from "@/lib/lease-audit";
import { resolveStatsPath } from "@/lib/agent-outcome-stats";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath") ?? undefined;
  const queueType = request.nextUrl.searchParams.get("queueType") ?? undefined;
  const agent = request.nextUrl.searchParams.get("agent") ?? undefined;
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? undefined;
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? undefined;

  try {
    const roots = await resolveAuditLogRoots(repoPath);
    let events = await readLeaseAuditEvents(roots);

    events = applyFilters(events, { queueType, agent, dateFrom, dateTo });

    const aggregates = aggregateLeaseAudit(events);
    return NextResponse.json({ events, aggregates });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load lease audit data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const AUDIT_FILENAME = "lease-audit.jsonl";

export async function DELETE() {
  try {
    const roots = await resolveAuditLogRoots();
    const truncated: string[] = [];

    // Truncate lease-audit.jsonl in all roots
    for (const root of roots) {
      const filePath = join(root, AUDIT_FILENAME);
      try {
        await writeFile(filePath, "", "utf-8");
        truncated.push(filePath);
      } catch {
        // File may not exist yet — that's fine
      }
    }

    // Truncate agent-success-rates.jsonl
    try {
      await writeFile(resolveStatsPath(), "", "utf-8");
      truncated.push(resolveStatsPath());
    } catch {
      // File may not exist yet — that's fine
    }

    return NextResponse.json({ ok: true, truncated });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reset audit data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function applyFilters(
  events: LeaseAuditEvent[],
  filters: {
    queueType?: string;
    agent?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): LeaseAuditEvent[] {
  let filtered = events;

  if (filters.queueType) {
    const qt = filters.queueType;
    filtered = filtered.filter((e) => e.queueType === qt);
  }

  if (filters.agent) {
    const parts = filters.agent.split("/");
    const provider = parts[0]?.toLowerCase();
    const model = parts[1]?.toLowerCase();
    filtered = filtered.filter((e) => {
      if (provider && e.agent.provider?.toLowerCase() !== provider) return false;
      if (model && e.agent.model?.toLowerCase() !== model) return false;
      return true;
    });
  }

  if (filters.dateFrom) {
    const from = filters.dateFrom;
    filtered = filtered.filter((e) => e.timestamp.slice(0, 10) >= from);
  }

  if (filters.dateTo) {
    const to = filters.dateTo;
    filtered = filtered.filter((e) => e.timestamp.slice(0, 10) <= to);
  }

  return filtered;
}
