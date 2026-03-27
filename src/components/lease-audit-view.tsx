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
  discoverAgents,
  bestOverallAgent,
  buildAgentBreakdown,
  aggregateDurations,
} from "@/components/lease-audit-helpers";
import type {
  LeaderboardEntry,
  AgentStepRow,
  DurationStats,
} from "@/components/lease-audit-helpers";
import {
  buildSpeedTable,
  buildEffSpeedLeaderboard,
  buildRawSpeedLeaderboard,
} from "@/components/lease-audit-speed";
import type { SpeedRow } from "@/components/lease-audit-speed";
import { AgentBreakdownBody } from "@/components/agent-breakdown-body";
import {
  EffSpeedLeaderboardTable,
  RawSpeedLeaderboardTable,
} from "@/components/speed-leaderboard-tables";
import type { LeaseAuditEvent } from "@/lib/lease-audit";

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

type RangePreset = "last7d" | "last24h" | "custom";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFrom(): string {
  return isoDate(new Date(Date.now() - 7 * MS_PER_DAY));
}

// ── Main view ──

export function LeaseAuditView({
  repoPath,
}: LeaseAuditViewProps) {
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [preset, setPreset] = useState<RangePreset>("last7d");
  const [selectedAgent, setSelectedAgent] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["lease-audit", repoPath, preset, dateFrom, dateTo],
    queryFn: () =>
      fetchLeaseAudit({
        repoPath,
        ...(preset === "last24h"
          ? { preset: "last24h" }
          : preset === "last7d"
            ? { preset: "last7d" }
            : { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
      }),
  });

  const aggregates = useMemo(() => data?.aggregates ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const topAgent = useMemo(
    () => bestOverallAgent(aggregates),
    [aggregates],
  );
  const effectiveAgent = selectedAgent || topAgent;

  const derived = useAuditDerived(
    aggregates, events, effectiveAgent,
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
      <AuditCharts
        queueSeriesMap={derived.queueSeriesMap}
        combinedSeries={derived.combinedSeries}
      />
      <EffSpeedLeaderboardTable
        rows={derived.effSpeedLeaderboard}
      />
      <RateLeaderboardTable
        leaderboard={derived.leaderboard}
      />
      <RawSpeedLeaderboardTable
        rows={derived.rawSpeedLeaderboard}
      />
      <AgentBreakdownTable
        agents={derived.agents}
        selectedAgent={effectiveAgent}
        setSelectedAgent={setSelectedAgent}
        rows={derived.agentBreakdown}
        durationMap={derived.durationMap}
        speedRows={derived.speedRows}
      />
    </div>
  );
}

// ── Hooks ──

type Aggregates = Parameters<typeof buildLeaderboard>[0];

function useAuditDerived(
  aggregates: Aggregates,
  events: LeaseAuditEvent[],
  selectedAgent: string,
) {
  const queueTypes = useMemo(
    () => discoverQueueTypes(aggregates), [aggregates],
  );
  const queueSeriesMap = useMemo(() => {
    const map = new Map<string, AgentSeries[]>();
    for (const qt of queueTypes) {
      map.set(qt, buildQueueSeries(aggregates, qt));
    }
    return map;
  }, [aggregates, queueTypes]);
  const combinedSeries = useMemo(
    () => buildCombinedSeries(aggregates),
    [aggregates],
  );
  const leaderboard = useMemo(
    () => buildLeaderboard(aggregates), [aggregates],
  );
  const agents = useMemo(
    () => discoverAgents(aggregates), [aggregates],
  );
  const agentBreakdown = useMemo(
    () => (selectedAgent
      ? buildAgentBreakdown(aggregates, selectedAgent)
      : []),
    [aggregates, selectedAgent],
  );
  const speedRows = useMemo(
    () => buildSpeedTable(events, aggregates),
    [events, aggregates],
  );
  const durationMap = useMemo(() => {
    const durations = aggregateDurations(events);
    const map = new Map<string, DurationStats>();
    for (const d of durations) {
      map.set(`${d.agent}::${d.step}`, d);
    }
    return map;
  }, [events]);
  const effSpeedLeaderboard = useMemo(
    () => buildEffSpeedLeaderboard(events, aggregates),
    [events, aggregates],
  );
  const rawSpeedLeaderboard = useMemo(
    () => buildRawSpeedLeaderboard(events, aggregates),
    [events, aggregates],
  );
  return {
    queueSeriesMap, combinedSeries, leaderboard,
    agents, agentBreakdown, speedRows, durationMap,
    effSpeedLeaderboard, rawSpeedLeaderboard,
  };
}

// ── Sub-components ──

function AuditCharts({
  queueSeriesMap,
  combinedSeries,
}: {
  queueSeriesMap: Map<string, AgentSeries[]>;
  combinedSeries: AgentSeries[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <TimeseriesChart
        title="Implementation"
        seriesList={queueSeriesMap.get("implementation") ?? []}
      />
      <TimeseriesChart
        title="Planning"
        seriesList={queueSeriesMap.get("planning") ?? []}
      />
      <TimeseriesChart title="Total" seriesList={combinedSeries} />
    </div>
  );
}

function presetDates(p: RangePreset) {
  const now = new Date();
  const to = isoDate(now);
  const ms = p === "last24h" ? MS_PER_DAY : 7 * MS_PER_DAY;
  return { from: isoDate(new Date(now.getTime() - ms)), to };
}

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
  function togglePreset(p: RangePreset) {
    if (preset === p) {
      setPreset("custom");
    } else {
      setPreset(p);
      const d = presetDates(p);
      setDateFrom(d.from);
      setDateTo(d.to);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <PresetButton
        label="24h"
        active={preset === "last24h"}
        onClick={() => togglePreset("last24h")}
      />
      <PresetButton
        label="7d"
        active={preset === "last7d"}
        onClick={() => togglePreset("last7d")}
      />
      <DateInput
        id="audit-date-from"
        label="From"
        value={dateFrom}
        onChange={(v) => { setDateFrom(v); setPreset("custom"); }}
      />
      <DateInput
        id="audit-date-to"
        label="To"
        value={dateTo}
        onChange={(v) => { setDateTo(v); setPreset("custom"); }}
      />
    </div>
  );
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-md border px-3 text-xs transition-colors ${
        active
          ? "border-foreground/30 bg-foreground/10 text-foreground"
          : "border-border/70 bg-background text-muted-foreground hover:bg-muted/30"
      }`}
    >
      {label}
    </button>
  );
}

function DateInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
      />
    </div>
  );
}

function RateLeaderboardTable(
  { leaderboard }: { leaderboard: LeaderboardEntry[] },
) {
  if (leaderboard.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        By Success Rate
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <TH align="left">Step</TH>
              <TH align="left">Best Agent</TH>
              <TH align="right">Rate</TH>
              <TH align="right">Margin</TH>
              <TH align="right">n</TH>
            </tr>
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
    </div>
  );
}

function TH({ align, children }: { align: "left" | "right"; children: React.ReactNode }) {
  return (
    <th className={`px-3 py-2 font-medium text-muted-foreground text-${align}`}>
      {children}
    </th>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function LeaderboardRow({ entry, even }: { entry: LeaderboardEntry; even: boolean }) {
  return (
    <tr className={even ? "bg-background" : "bg-muted/10"}>
      <td className="px-3 py-1.5 font-medium text-foreground">
        {capitalize(entry.step)}
      </td>
      <td className="px-3 py-1.5 text-foreground">{entry.bestAgent}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-green-600 dark:text-green-400">
        {entry.bestRate}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{entry.margin}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        {entry.totalN}
      </td>
    </tr>
  );
}

function AgentBreakdownTable({
  agents,
  selectedAgent,
  setSelectedAgent,
  rows,
  durationMap,
  speedRows,
}: {
  agents: string[];
  selectedAgent: string;
  setSelectedAgent: (v: string) => void;
  rows: AgentStepRow[];
  durationMap: Map<string, DurationStats>;
  speedRows: SpeedRow[];
}) {
  if (agents.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label
          htmlFor="agent-select"
          className="text-xs font-medium text-muted-foreground"
        >
          Agent Breakdown
        </label>
        <select
          id="agent-select"
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs"
        >
          <option value="">Select agent...</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
      {rows.length > 0 && (
        <AgentBreakdownBody
          rows={rows}
          agent={selectedAgent}
          durationMap={durationMap}
          speedRows={speedRows}
        />
      )}
    </div>
  );
}

