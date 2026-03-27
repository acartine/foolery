import { formatAgentOptionLabel } from "@/lib/agent-identity";
import type {
  LeaseAuditAggregate,
  LeaseAuditEvent,
} from "@/lib/lease-audit";
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
  bestN: number;
  runnerUp: string;
  runnerUpRate: string;
  margin: string;
  totalN: number;
}

export interface AgentStepRow {
  step: string;
  rate: number;
  n: number;
  meanRate: number;
  offset: string;
}

export function agentLabel(agent: LeaseAuditAggregate["agent"]): string {
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
    let n = 0;
    const points = dateRange.map((date) => ({
      date,
      value: (() => {
        const totals = dateMap.get(date);
        if (!totals) return null;
        const completed = totals.successes + totals.failures;
        if (completed === 0) return null;
        n += completed;
        return Math.round((totals.successes / completed) * 100);
      })(),
    }));
    series.push({ agent, points, n });
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

function stepAgentStats(
  aggregates: LeaseAuditAggregate[],
  step: string,
): Map<string, { successes: number; failures: number }> {
  const map = new Map<
    string,
    { successes: number; failures: number }
  >();
  for (const agg of aggregates) {
    if (agg.queueType !== step) continue;
    if (
      agg.outcome !== "success" &&
      agg.outcome !== "fail"
    )
      continue;
    const agent = agentLabel(agg.agent);
    const s = map.get(agent) ?? {
      successes: 0,
      failures: 0,
    };
    if (agg.outcome === "success")
      s.successes += agg.count;
    else s.failures += agg.count;
    map.set(agent, s);
  }
  return map;
}

function meanRate(
  stats: Map<
    string,
    { successes: number; failures: number }
  >,
): number {
  const rates: number[] = [];
  for (const s of stats.values()) {
    const total = s.successes + s.failures;
    if (total > 0)
      rates.push((s.successes / total) * 100);
  }
  if (rates.length === 0) return 0;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

function formatOffset(diff: number): string {
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${Math.round(diff)}%`;
}

export function buildLeaderboard(
  aggregates: LeaseAuditAggregate[],
): LeaderboardEntry[] {
  const steps = discoverQueueTypes(aggregates);
  const entries: LeaderboardEntry[] = [];

  for (const step of steps) {
    const stats = stepAgentStats(aggregates, step);
    const mean = meanRate(stats);

    const ranked = [...stats.entries()]
      .map(([agent, s]) => {
        const total = s.successes + s.failures;
        const rate =
          total > 0
            ? (s.successes / total) * 100
            : 0;
        return { agent, rate, total };
      })
      .filter((r) => r.total > 0)
      .sort(
        (a, b) =>
          b.rate - a.rate || b.total - a.total,
      );

    if (ranked.length === 0) continue;

    const best = ranked[0]!;
    const runnerUp =
      ranked.length > 1 ? ranked[1]! : null;

    const totalN = ranked.reduce(
      (sum, r) => sum + r.total,
      0,
    );
    entries.push({
      step,
      bestAgent: best.agent,
      bestRate: `${Math.round(best.rate)}%`,
      bestN: best.total,
      runnerUp: runnerUp ? runnerUp.agent : "-",
      runnerUpRate: runnerUp
        ? `${Math.round(runnerUp.rate)}%`
        : "-",
      margin: formatOffset(best.rate - mean),
      totalN,
    });
  }

  return entries;
}

export function discoverAgents(
  aggregates: LeaseAuditAggregate[],
): string[] {
  const agents = new Set<string>();
  for (const agg of aggregates) {
    agents.add(agentLabel(agg.agent));
  }
  return [...agents].sort();
}

export function bestOverallAgent(
  aggregates: LeaseAuditAggregate[],
): string {
  const map = new Map<
    string,
    { successes: number; failures: number }
  >();
  for (const agg of aggregates) {
    if (
      agg.outcome !== "success" &&
      agg.outcome !== "fail"
    )
      continue;
    const agent = agentLabel(agg.agent);
    const s = map.get(agent) ?? {
      successes: 0,
      failures: 0,
    };
    if (agg.outcome === "success")
      s.successes += agg.count;
    else s.failures += agg.count;
    map.set(agent, s);
  }
  let best = "";
  let bestRate = -1;
  let bestN = 0;
  for (const [agent, s] of map) {
    const total = s.successes + s.failures;
    if (total === 0) continue;
    const rate = s.successes / total;
    if (
      rate > bestRate ||
      (rate === bestRate && total > bestN)
    ) {
      best = agent;
      bestRate = rate;
      bestN = total;
    }
  }
  return best;
}

export function buildAgentBreakdown(
  aggregates: LeaseAuditAggregate[],
  agentName: string,
): AgentStepRow[] {
  const steps = discoverQueueTypes(aggregates);
  const rows: AgentStepRow[] = [];

  for (const step of steps) {
    const allStats = stepAgentStats(
      aggregates,
      step,
    );
    const mean = meanRate(allStats);
    const s = allStats.get(agentName);
    if (!s) continue;
    const total = s.successes + s.failures;
    if (total === 0) continue;
    const rate = (s.successes / total) * 100;
    rows.push({
      step,
      rate: Math.round(rate),
      n: total,
      meanRate: Math.round(mean),
      offset: formatOffset(rate - mean),
    });
  }

  return rows;
}

// ─── Duration aggregation ─────────────────────────────

export interface DurationStats {
  agent: string;
  step: string;
  median: number;
  p90: number;
  mean: number;
  timedCount: number;
  totalCount: number;
}

function computePercentile(
  sorted: number[],
  p: number,
): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function aggregateDurations(
  events: LeaseAuditEvent[],
): DurationStats[] {
  const timedMap = new Map<
    string,
    { agent: string; step: string; durations: number[] }
  >();
  const totalMap = new Map<string, number>();

  for (const e of events) {
    if (e.outcome !== "success" && e.outcome !== "fail")
      continue;
    const agent = agentLabel(e.agent);
    const key = `${agent}::${e.queueType}`;
    totalMap.set(key, (totalMap.get(key) ?? 0) + 1);

    if (e.durationMs == null) continue;
    let entry = timedMap.get(key);
    if (!entry) {
      entry = {
        agent, step: e.queueType, durations: [],
      };
      timedMap.set(key, entry);
    }
    entry.durations.push(e.durationMs);
  }

  const results: DurationStats[] = [];
  for (const [key, entry] of timedMap) {
    const sorted = [...entry.durations].sort(
      (a, b) => a - b,
    );
    const sum = sorted.reduce((a, b) => a + b, 0);
    results.push({
      agent: entry.agent,
      step: entry.step,
      median: computePercentile(sorted, 50),
      p90: computePercentile(sorted, 90),
      mean: sum / sorted.length,
      timedCount: sorted.length,
      totalCount: totalMap.get(key) ?? sorted.length,
    });
  }

  return results.sort((a, b) =>
    a.agent.localeCompare(b.agent) ||
    a.step.localeCompare(b.step),
  );
}
