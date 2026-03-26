import { formatAgentOptionLabel } from "@/lib/agent-identity";
import type { LeaseAuditAggregate } from "@/lib/lease-audit";
import type { AgentSeries } from "@/components/timeseries-chart";

export interface AgentRow {
  agentDisplay: string;
  completed: number;
  successes: number;
  failures: number;
  successRate: string;
}

export interface LeaderboardEntry {
  step: string;
  bestAgent: string;
  bestRate: string;
  runnerUp: string;
  runnerUpRate: string;
  margin: string;
}

function agentLabel(agent: LeaseAuditAggregate["agent"]): string {
  const label = formatAgentOptionLabel({
    provider: agent.provider,
    model: agent.model,
    flavor: agent.flavor,
    version: agent.version,
  });
  return label || "Unknown";
}

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

function buildAgentDateMap(
  filtered: LeaseAuditAggregate[],
): Map<string, Map<string, { successes: number; failures: number }>> {
  const agentMap = new Map<
    string,
    Map<string, { successes: number; failures: number }>
  >();
  for (const agg of filtered) {
    const agent = agentLabel(agg.agent);
    let dateMap = agentMap.get(agent);
    if (!dateMap) {
      dateMap = new Map<string, { successes: number; failures: number }>();
      agentMap.set(agent, dateMap);
    }
    const totals = dateMap.get(agg.date) ?? { successes: 0, failures: 0 };
    if (agg.outcome === "success") totals.successes += agg.count;
    else totals.failures += agg.count;
    dateMap.set(agg.date, totals);
  }
  return agentMap;
}

function agentMapToSeries(
  agentMap: Map<string, Map<string, { successes: number; failures: number }>>,
  dateRange: string[],
): AgentSeries[] {
  const series: AgentSeries[] = [];
  for (const [agent, dateMap] of agentMap) {
    const points = dateRange.map((date) => ({
      date,
      value: (() => {
        const totals = dateMap.get(date);
        if (!totals) return null;
        const completed = totals.successes + totals.failures;
        if (completed === 0) return null;
        return Math.round((totals.successes / completed) * 100);
      })(),
    }));
    series.push({ agent, points });
  }
  return series.sort((a, b) => a.agent.localeCompare(b.agent));
}

export function buildQueueSeries(
  aggregates: LeaseAuditAggregate[],
  queueType: string,
): AgentSeries[] {
  const filtered = aggregates.filter(
    (a) =>
      a.queueType === queueType &&
      (a.outcome === "success" || a.outcome === "fail"),
  );
  if (filtered.length === 0) return [];
  const allDates = aggregates.map((a) => a.date);
  const dateRange = buildDateRange(allDates);
  const agentMap = buildAgentDateMap(filtered);
  return agentMapToSeries(agentMap, dateRange);
}

export function buildCombinedSeries(
  aggregates: LeaseAuditAggregate[],
): AgentSeries[] {
  const filtered = aggregates.filter(
    (a) => a.outcome === "success" || a.outcome === "fail",
  );
  if (filtered.length === 0) return [];
  const allDates = aggregates.map((a) => a.date);
  const dateRange = buildDateRange(allDates);
  const agentMap = buildAgentDateMap(filtered);
  return agentMapToSeries(agentMap, dateRange);
}

export function buildAgentRows(aggregates: LeaseAuditAggregate[]): AgentRow[] {
  const map = new Map<string, AgentRow>();
  for (const agg of aggregates) {
    const display = agentLabel(agg.agent);
    let row = map.get(display);
    if (!row) {
      row = {
        agentDisplay: display,
        completed: 0,
        successes: 0,
        failures: 0,
        successRate: "-",
      };
      map.set(display, row);
    }
    if (agg.outcome === "success") row.successes += agg.count;
    else if (agg.outcome === "fail") row.failures += agg.count;
  }

  for (const row of map.values()) {
    const total = row.successes + row.failures;
    row.completed = total;
    row.successRate =
      total > 0 ? `${Math.round((row.successes / total) * 100)}%` : "-";
  }

  return Array.from(map.values()).sort((a, b) => b.completed - a.completed);
}

export function discoverQueueTypes(aggregates: LeaseAuditAggregate[]): string[] {
  return [...new Set(aggregates.map((a) => a.queueType))].sort();
}

export function buildLeaderboard(
  aggregates: LeaseAuditAggregate[],
): LeaderboardEntry[] {
  const steps = discoverQueueTypes(aggregates);
  const entries: LeaderboardEntry[] = [];

  for (const step of steps) {
    const agentStats = new Map<string, { successes: number; failures: number }>();
    for (const agg of aggregates) {
      if (agg.queueType !== step) continue;
      if (agg.outcome !== "success" && agg.outcome !== "fail") continue;
      const agent = agentLabel(agg.agent);
      const stats = agentStats.get(agent) ?? { successes: 0, failures: 0 };
      if (agg.outcome === "success") stats.successes += agg.count;
      else stats.failures += agg.count;
      agentStats.set(agent, stats);
    }

    const ranked = [...agentStats.entries()]
      .map(([agent, stats]) => {
        const total = stats.successes + stats.failures;
        const rate = total > 0 ? (stats.successes / total) * 100 : 0;
        return { agent, rate, total };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.rate - a.rate || b.total - a.total);

    if (ranked.length === 0) continue;

    const best = ranked[0]!;
    const runnerUp = ranked.length > 1 ? ranked[1]! : null;

    entries.push({
      step,
      bestAgent: best.agent,
      bestRate: `${Math.round(best.rate)}%`,
      runnerUp: runnerUp ? runnerUp.agent : "-",
      runnerUpRate: runnerUp ? `${Math.round(runnerUp.rate)}%` : "-",
      margin: runnerUp
        ? `${Math.round(best.rate - runnerUp.rate)}pp`
        : "-",
    });
  }

  return entries;
}
