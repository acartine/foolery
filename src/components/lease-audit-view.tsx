"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLeaseAudit } from "@/lib/lease-audit-api";
import { formatAgentOptionLabel } from "@/lib/agent-identity";
import type { LeaseAuditAggregate } from "@/lib/lease-audit";

interface LeaseAuditViewProps {
  repoPath?: string;
}

/** Produce a human-readable label from the aggregate agent fields. */
function agentLabel(agent: LeaseAuditAggregate["agent"]): string {
  const label = formatAgentOptionLabel({
    provider: agent.provider,
    model: agent.model,
    flavor: agent.flavor,
    version: agent.version,
  });
  return label || "Unknown";
}

interface AuditRow {
  agentDisplay: string;
  queueType: string;
  date: string;
  claims: number;
  successes: number;
  failures: number;
  successRate: string;
}

function buildRows(aggregates: LeaseAuditAggregate[]): AuditRow[] {
  const map = new Map<string, AuditRow>();

  for (const agg of aggregates) {
    const display = agentLabel(agg.agent);
    const key = `${display}::${agg.queueType}::${agg.date}`;
    let row = map.get(key);
    if (!row) {
      row = {
        agentDisplay: display,
        queueType: agg.queueType,
        date: agg.date,
        claims: 0,
        successes: 0,
        failures: 0,
        successRate: "0%",
      };
      map.set(key, row);
    }
    if (agg.outcome === "claim") row.claims += agg.count;
    else if (agg.outcome === "success") row.successes += agg.count;
    else if (agg.outcome === "fail") row.failures += agg.count;
  }

  for (const row of map.values()) {
    const total = row.successes + row.failures;
    row.successRate = total > 0 ? `${Math.round((row.successes / total) * 100)}%` : "-";
  }

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function extractQueueTypes(aggregates: LeaseAuditAggregate[]): string[] {
  const set = new Set<string>();
  for (const agg of aggregates) set.add(agg.queueType);
  return Array.from(set).sort();
}

export function LeaseAuditView({ repoPath }: LeaseAuditViewProps) {
  const [queueTypeFilter, setQueueTypeFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["lease-audit", repoPath, queueTypeFilter, dateFrom, dateTo],
    queryFn: () =>
      fetchLeaseAudit({
        repoPath,
        queueType: queueTypeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
  });

  const rows = useMemo(() => buildRows(data?.aggregates ?? []), [data]);
  const queueTypes = useMemo(() => extractQueueTypes(data?.aggregates ?? []), [data]);

  const totals = useMemo(() => {
    let claims = 0;
    let successes = 0;
    let failures = 0;
    for (const row of rows) {
      claims += row.claims;
      successes += row.successes;
      failures += row.failures;
    }
    return { claims, successes, failures };
  }, [rows]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        Loading audit data...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="flex items-center gap-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <SummaryItem label="Total Claims" value={totals.claims} />
        <SummaryItem label="Successes" value={totals.successes} />
        <SummaryItem label="Failures" value={totals.failures} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="audit-queue-type" className="text-[11px] text-muted-foreground">
            Queue Type
          </label>
          <select
            id="audit-queue-type"
            value={queueTypeFilter}
            onChange={(e) => setQueueTypeFilter(e.target.value)}
            className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
          >
            <option value="">All</option>
            {queueTypes.map((qt) => (
              <option key={qt} value={qt}>
                {qt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-date-from" className="text-[11px] text-muted-foreground">
            From
          </label>
          <input
            id="audit-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-date-to" className="text-[11px] text-muted-foreground">
            To
          </label>
          <input
            id="audit-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No audit data available.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Agent</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Queue Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Claims</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Successes</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Failures</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.agentDisplay}-${row.queueType}-${row.date}`}
                  className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}
                >
                  <td className="px-3 py-1.5 text-foreground">{row.agentDisplay}</td>
                  <td className="px-3 py-1.5 text-foreground">{row.queueType}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.date}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.claims}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-green-600 dark:text-green-400">
                    {row.successes}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">
                    {row.failures}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.successRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
