"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLeaseAudit } from "@/lib/lease-audit-api";
import { formatAgentOptionLabel } from "@/lib/agent-identity";
import type { LeaseAuditAggregate } from "@/lib/lease-audit";

// ── Chart color palette (maps to --chart-1 … --chart-5 CSS vars) ────

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function colorForIndex(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length]!;
}

// ── Types ───────────────────────────────────────────────────────────

interface LeaseAuditViewProps {
  repoPath?: string;
}

interface AgentRow {
  agentDisplay: string;
  claims: number;
  successes: number;
  failures: number;
  successRate: string;
}

interface TimeseriesPoint {
  date: string;
  value: number;
}

interface AgentSeries {
  agent: string;
  points: TimeseriesPoint[];
}

// ── Helpers ─────────────────────────────────────────────────────────

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

/** Build a sorted list of all dates in the aggregate range (inclusive). */
export function buildDateRange(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const sorted = [...new Set(dates)].sort();
  const start = new Date(sorted[0]!);
  const end = new Date(sorted[sorted.length - 1]!);
  const result: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

/** Build per-agent timeseries for a given queue type (claim counts per day). */
export function buildQueueSeries(
  aggregates: LeaseAuditAggregate[],
  queueType: string,
): AgentSeries[] {
  // Filter to the target queue and only claim outcomes
  const filtered = aggregates.filter(
    (a) => a.queueType === queueType && a.outcome === "claim",
  );
  if (filtered.length === 0) return [];

  // Determine full date range from ALL aggregates for consistent x-axis
  const allDates = aggregates.map((a) => a.date);
  const dateRange = buildDateRange(allDates);

  // Group by agent
  const agentMap = new Map<string, Map<string, number>>();
  for (const agg of filtered) {
    const agent = agentLabel(agg.agent);
    let dateMap = agentMap.get(agent);
    if (!dateMap) {
      dateMap = new Map<string, number>();
      agentMap.set(agent, dateMap);
    }
    dateMap.set(agg.date, (dateMap.get(agg.date) ?? 0) + agg.count);
  }

  // Build zero-filled series
  const series: AgentSeries[] = [];
  for (const [agent, dateMap] of agentMap) {
    const points = dateRange.map((date) => ({
      date,
      value: dateMap.get(date) ?? 0,
    }));
    series.push({ agent, points });
  }
  return series.sort((a, b) => a.agent.localeCompare(b.agent));
}

/** Build agent-only table rows (no date dimension). */
export function buildAgentRows(aggregates: LeaseAuditAggregate[]): AgentRow[] {
  const map = new Map<string, AgentRow>();
  for (const agg of aggregates) {
    const display = agentLabel(agg.agent);
    let row = map.get(display);
    if (!row) {
      row = {
        agentDisplay: display,
        claims: 0,
        successes: 0,
        failures: 0,
        successRate: "-",
      };
      map.set(display, row);
    }
    if (agg.outcome === "claim") row.claims += agg.count;
    else if (agg.outcome === "success") row.successes += agg.count;
    else if (agg.outcome === "fail") row.failures += agg.count;
  }

  for (const row of map.values()) {
    const total = row.successes + row.failures;
    row.successRate =
      total > 0 ? `${Math.round((row.successes / total) * 100)}%` : "-";
  }

  // Sort by highest total activity
  return Array.from(map.values()).sort((a, b) => b.claims - a.claims);
}

// ── Chart component ─────────────────────────────────────────────────

const CHART_HEIGHT = 120;
const CHART_PADDING_TOP = 8;
const CHART_PADDING_BOTTOM = 20;
const CHART_PADDING_LEFT = 32;
const CHART_PADDING_RIGHT = 8;

function TimeseriesChart({
  title,
  seriesList,
}: {
  title: string;
  seriesList: AgentSeries[];
}) {
  if (seriesList.length === 0) {
    return (
      <div className="flex-1 rounded-lg border border-border/60 bg-muted/10 p-3">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">
          {title}
        </h3>
        <p className="py-4 text-center text-xs text-muted-foreground">
          No data
        </p>
      </div>
    );
  }

  const dateLabels = seriesList[0]!.points.map((p) => p.date);
  const numPoints = dateLabels.length;
  const maxValue = Math.max(
    1,
    ...seriesList.flatMap((s) => s.points.map((p) => p.value)),
  );

  // Chart dimensions
  const drawWidth = Math.max(200, numPoints * 40);
  const totalWidth = CHART_PADDING_LEFT + drawWidth + CHART_PADDING_RIGHT;
  const drawHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  function xPos(i: number): number {
    if (numPoints <= 1) return CHART_PADDING_LEFT + drawWidth / 2;
    return CHART_PADDING_LEFT + (i / (numPoints - 1)) * drawWidth;
  }

  function yPos(value: number): number {
    return (
      CHART_PADDING_TOP + drawHeight - (value / maxValue) * drawHeight
    );
  }

  // Y-axis ticks
  const yTicks = [0, Math.round(maxValue / 2), maxValue];

  return (
    <div className="flex-1 rounded-lg border border-border/60 bg-muted/10 p-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto">
        <svg
          width={totalWidth}
          height={CHART_HEIGHT}
          className="block"
          role="img"
          aria-label={`${title} chart`}
        >
          {/* Y-axis grid lines + labels */}
          {yTicks.map((tick) => (
            <g key={`ytick-${tick}`}>
              <line
                x1={CHART_PADDING_LEFT}
                y1={yPos(tick)}
                x2={totalWidth - CHART_PADDING_RIGHT}
                y2={yPos(tick)}
                stroke="currentColor"
                strokeOpacity={0.1}
              />
              <text
                x={CHART_PADDING_LEFT - 4}
                y={yPos(tick) + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize={9}
              >
                {tick}
              </text>
            </g>
          ))}

          {/* Date labels */}
          {dateLabels.map((date, i) => {
            // Show all labels if few, otherwise skip
            const showLabel =
              numPoints <= 7 || i === 0 || i === numPoints - 1 || i % Math.ceil(numPoints / 7) === 0;
            if (!showLabel) return null;
            return (
              <text
                key={`xlabel-${date}`}
                x={xPos(i)}
                y={CHART_HEIGHT - 2}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={8}
              >
                {date.slice(5)}
              </text>
            );
          })}

          {/* Series lines + dots */}
          {seriesList.map((series, si) => {
            const color = colorForIndex(si);
            const pathD = series.points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${xPos(i)} ${yPos(p.value)}`)
              .join(" ");
            return (
              <g key={series.agent}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
                {series.points.map((p, i) => (
                  <circle
                    key={`${series.agent}-${p.date}`}
                    cx={xPos(i)}
                    cy={yPos(p.value)}
                    r={2.5}
                    fill={color}
                  >
                    <title>
                      {series.agent}: {p.value} on {p.date}
                    </title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3">
        {seriesList.map((series, si) => (
          <div key={series.agent} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: colorForIndex(si) }}
            />
            {series.agent}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────

export function LeaseAuditView({ repoPath }: LeaseAuditViewProps) {
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Fetch ALL data (no queueType filter) so both charts can render
  const { data, isLoading } = useQuery({
    queryKey: ["lease-audit", repoPath, dateFrom, dateTo],
    queryFn: () =>
      fetchLeaseAudit({
        repoPath,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
  });

  const aggregates = data?.aggregates ?? [];

  const planningSeries = useMemo(
    () => buildQueueSeries(aggregates, "planning"),
    [aggregates],
  );
  const implementationSeries = useMemo(
    () => buildQueueSeries(aggregates, "implementation"),
    [aggregates],
  );
  const rows = useMemo(() => buildAgentRows(aggregates), [aggregates]);

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

      {/* Filters (date only — queue type filter removed since charts show both) */}
      <div className="flex flex-wrap items-end gap-3">
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

      {/* Timeseries charts */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <TimeseriesChart title="Planning Claims" seriesList={planningSeries} />
        <TimeseriesChart
          title="Implementation Claims"
          seriesList={implementationSeries}
        />
      </div>

      {/* Agent-only table */}
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
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Claims</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Successes</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Failures</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.agentDisplay}
                  className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}
                >
                  <td className="px-3 py-1.5 text-foreground">{row.agentDisplay}</td>
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
