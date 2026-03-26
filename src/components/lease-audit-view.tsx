"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLeaseAudit } from "@/lib/lease-audit-api";
import { TimeseriesChart } from "@/components/timeseries-chart";
import type { AgentSeries } from "@/components/timeseries-chart";
import {
  buildQueueSeries,
  buildCombinedSeries,
  buildLeaderboard,
  discoverQueueTypes,
} from "@/components/lease-audit-helpers";
import type { LeaderboardEntry } from "@/components/lease-audit-helpers";

// Re-export for backward compatibility
export type { LeaderboardEntry };
export {
  buildDateRange,
  buildQueueSeries,
  buildCombinedSeries,
  buildAgentRows,
  discoverQueueTypes,
  buildLeaderboard,
} from "@/components/lease-audit-helpers";

interface LeaseAuditViewProps {
  repoPath?: string;
}

type RangePreset = "last24h" | "custom";

// ── Main view ──

export function LeaseAuditView({
  repoPath,
}: LeaseAuditViewProps) {
  const [dateFrom, setDateFrom] =
    useState<string>("");
  const [dateTo, setDateTo] =
    useState<string>("");
  const [preset, setPreset] =
    useState<RangePreset>("custom");

  const { data, isLoading } = useQuery({
    queryKey: [
      "lease-audit",
      repoPath,
      preset,
      dateFrom,
      dateTo,
    ],
    queryFn: () =>
      fetchLeaseAudit({
        repoPath,
        ...(preset === "last24h"
          ? { preset: "last24h" }
          : {
              dateFrom: dateFrom || undefined,
              dateTo: dateTo || undefined,
            }),
      }),
  });

  const aggregates = useMemo(
    () => data?.aggregates ?? [],
    [data],
  );
  const queueTypes = useMemo(
    () => discoverQueueTypes(aggregates),
    [aggregates],
  );
  const queueSeriesMap = useMemo(() => {
    const map = new Map<string, AgentSeries[]>();
    for (const qt of queueTypes) {
      map.set(
        qt,
        buildQueueSeries(aggregates, qt),
      );
    }
    return map;
  }, [aggregates, queueTypes]);
  const combinedSeries = useMemo(
    () => buildCombinedSeries(aggregates),
    [aggregates],
  );
  const leaderboard = useMemo(
    () => buildLeaderboard(aggregates),
    [aggregates],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        Loading audit data...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RangeControls
        preset={preset}
        dateFrom={dateFrom}
        dateTo={dateTo}
        setPreset={setPreset}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
      />

      <div className="flex flex-col gap-4 sm:flex-row">
        {queueTypes.map((qt) => (
          <TimeseriesChart
            key={qt}
            title={`${qt.charAt(0).toUpperCase() + qt.slice(1)} Success Rate`}
            seriesList={
              queueSeriesMap.get(qt) ?? []
            }
          />
        ))}
        <TimeseriesChart
          title="All Steps Success Rate"
          seriesList={combinedSeries}
        />
      </div>

      <LeaderboardTable
        leaderboard={leaderboard}
      />
    </div>
  );
}

// ── Sub-components ──

function RangeControls({
  preset,
  dateFrom,
  dateTo,
  setPreset,
  setDateFrom,
  setDateTo,
}: {
  preset: RangePreset;
  dateFrom: string;
  dateTo: string;
  setPreset: (p: RangePreset) => void;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
}) {
  function rangeLabel(): string {
    if (preset === "last24h")
      return "Last 24 hours";
    if (dateFrom && dateTo)
      return `${dateFrom} to ${dateTo}`;
    if (dateFrom) return `From ${dateFrom}`;
    if (dateTo) return `Through ${dateTo}`;
    return "All time";
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <button
        type="button"
        onClick={() => {
          setPreset("last24h");
          setDateFrom("");
          setDateTo("");
        }}
        className={`h-8 rounded-md border px-3 text-xs transition-colors ${
          preset === "last24h"
            ? "border-foreground/30 bg-foreground/10 text-foreground"
            : "border-border/70 bg-background text-muted-foreground hover:bg-muted/30"
        }`}
      >
        Last 24h
      </button>

      <div className="space-y-1">
        <label
          htmlFor="audit-date-from"
          className="text-[11px] text-muted-foreground"
        >
          From
        </label>
        <input
          id="audit-date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPreset("custom");
          }}
          className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
        />
      </div>
      <div className="space-y-1">
        <label
          htmlFor="audit-date-to"
          className="text-[11px] text-muted-foreground"
        >
          To
        </label>
        <input
          id="audit-date-to"
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPreset("custom");
          }}
          className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
        />
      </div>

      <span className="pb-1 text-[11px] text-muted-foreground">
        {rangeLabel()}
      </span>
    </div>
  );
}

function LeaderboardTable({
  leaderboard,
}: {
  leaderboard: LeaderboardEntry[];
}) {
  if (leaderboard.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No audit data available.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead>
          <LeaderboardHeaderRow />
        </thead>
        <tbody>
          {leaderboard.map((entry, i) => (
            <LeaderboardRow
              key={entry.step}
              entry={entry}
              even={i % 2 === 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaderboardHeaderRow() {
  const thClass =
    "px-3 py-2 font-medium text-muted-foreground";
  return (
    <tr className="border-b border-border/60 bg-muted/30">
      <th className={`${thClass} text-left`}>
        Step
      </th>
      <th className={`${thClass} text-left`}>
        Best Agent
      </th>
      <th className={`${thClass} text-right`}>
        Rate
      </th>
      <th className={`${thClass} text-left`}>
        Runner-up
      </th>
      <th className={`${thClass} text-right`}>
        Rate
      </th>
      <th className={`${thClass} text-right`}>
        Margin
      </th>
    </tr>
  );
}

function LeaderboardRow({
  entry,
  even,
}: {
  entry: LeaderboardEntry;
  even: boolean;
}) {
  return (
    <tr
      className={
        even ? "bg-background" : "bg-muted/10"
      }
    >
      <td className="px-3 py-1.5 font-medium text-foreground">
        {entry.step.charAt(0).toUpperCase() +
          entry.step.slice(1)}
      </td>
      <td className="px-3 py-1.5 text-foreground">
        {entry.bestAgent}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-green-600 dark:text-green-400">
        {entry.bestRate}
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {entry.runnerUp}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {entry.runnerUpRate}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {entry.margin}
      </td>
    </tr>
  );
}
