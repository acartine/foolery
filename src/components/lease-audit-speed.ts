import type {
  LeaseAuditEvent,
  LeaseAuditAggregate,
} from "@/lib/lease-audit";
import {
  agentLabel,
  aggregateDurations,
} from "@/components/lease-audit-helpers";
import type { DurationStats } from "@/components/lease-audit-helpers";

export interface SpeedRow {
  agent: string;
  step: string;
  rawMedian: number;
  successRate: number;
  attemptsPerShip: string;
  effectiveSpeed: number | null;
  n: number;
  totalN: number;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (totalMinutes < 60) {
    return secs > 0
      ? `${totalMinutes}m ${secs}s`
      : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

const REVIEW_STEP_MAP: Record<string, string> = {
  planning: "plan_review",
  implementation: "implementation_review",
  shipment: "shipment_review",
};

function computeAgentStepRates(
  aggregates: LeaseAuditAggregate[],
): Map<string, Map<string, { successes: number; total: number }>> {
  const result = new Map<
    string,
    Map<string, { successes: number; total: number }>
  >();
  for (const agg of aggregates) {
    if (agg.outcome !== "success" && agg.outcome !== "fail")
      continue;
    const agent = agentLabel(agg.agent);
    let stepMap = result.get(agent);
    if (!stepMap) {
      stepMap = new Map();
      result.set(agent, stepMap);
    }
    const s = stepMap.get(agg.queueType) ?? {
      successes: 0,
      total: 0,
    };
    if (agg.outcome === "success") s.successes += agg.count;
    s.total += agg.count;
    stepMap.set(agg.queueType, s);
  }
  return result;
}

function lookupReviewDuration(
  durationMap: Map<string, DurationStats>,
  agent: string,
  step: string,
): number {
  const reviewStep = REVIEW_STEP_MAP[step];
  if (!reviewStep) return 0;
  const key = `${agent}::${reviewStep}`;
  return durationMap.get(key)?.mean ?? 0;
}

function computeEffectiveSpeed(
  meanDuration: number,
  successRate: number,
  reviewDuration: number,
): number | null {
  if (successRate <= 0) return null;
  const rejectionRate = 1 - successRate / 100;
  const rateDecimal = successRate / 100;
  return (
    (meanDuration + rejectionRate * reviewDuration) /
    rateDecimal
  );
}

export function buildSpeedTable(
  events: LeaseAuditEvent[],
  aggregates: LeaseAuditAggregate[],
): SpeedRow[] {
  const durations = aggregateDurations(events);
  if (durations.length === 0) return [];

  const durationMap = new Map<string, DurationStats>();
  for (const d of durations) {
    durationMap.set(`${d.agent}::${d.step}`, d);
  }

  const rateMap = computeAgentStepRates(aggregates);
  const rows: SpeedRow[] = [];

  for (const d of durations) {
    const agentRates = rateMap.get(d.agent);
    const stepStats = agentRates?.get(d.step);
    const successRate = stepStats
      ? (stepStats.successes / stepStats.total) * 100
      : 0;

    const reviewDur = lookupReviewDuration(
      durationMap, d.agent, d.step,
    );
    const effSpeed = computeEffectiveSpeed(
      d.mean, successRate, reviewDur,
    );

    rows.push({
      agent: d.agent,
      step: d.step,
      rawMedian: d.median,
      successRate: Math.round(successRate),
      attemptsPerShip:
        successRate > 0
          ? (100 / successRate).toFixed(1)
          : "-",
      effectiveSpeed: effSpeed,
      n: d.timedCount,
      totalN: d.totalCount,
    });
  }

  return rows.sort(
    (a, b) =>
      a.agent.localeCompare(b.agent) ||
      a.step.localeCompare(b.step),
  );
}

// ── Effective-speed leaderboard ──

export interface EffSpeedLeader {
  step: string;
  bestAgent: string;
  effSpeed: string;
  rawSpeed: string;
  rate: string;
  attemptsPerShip: string;
  n: number;
}

export function buildEffSpeedLeaderboard(
  events: LeaseAuditEvent[],
  aggregates: LeaseAuditAggregate[],
): EffSpeedLeader[] {
  const rows = buildSpeedTable(events, aggregates);
  const byStep = new Map<string, SpeedRow>();
  for (const r of rows) {
    if (r.effectiveSpeed == null) continue;
    const best = byStep.get(r.step);
    if (!best || r.effectiveSpeed < best.effectiveSpeed!) {
      byStep.set(r.step, r);
    }
  }
  return Array.from(byStep.values())
    .sort((a, b) => a.step.localeCompare(b.step))
    .map((r) => ({
      step: r.step,
      bestAgent: r.agent,
      effSpeed: formatDuration(r.effectiveSpeed!),
      rawSpeed: formatDuration(r.rawMedian),
      rate: `${r.successRate}%`,
      attemptsPerShip: r.attemptsPerShip,
      n: r.n,
    }));
}

// ── Raw-speed leaderboard ──

export interface RawSpeedLeader {
  step: string;
  bestAgent: string;
  rawSpeed: string;
  rate: string;
  n: number;
}

export function buildRawSpeedLeaderboard(
  events: LeaseAuditEvent[],
  aggregates: LeaseAuditAggregate[],
): RawSpeedLeader[] {
  const rows = buildSpeedTable(events, aggregates);
  const byStep = new Map<string, SpeedRow>();
  for (const r of rows) {
    const best = byStep.get(r.step);
    if (!best || r.rawMedian < best.rawMedian) {
      byStep.set(r.step, r);
    }
  }
  return Array.from(byStep.values())
    .sort((a, b) => a.step.localeCompare(b.step))
    .map((r) => ({
      step: r.step,
      bestAgent: r.agent,
      rawSpeed: formatDuration(r.rawMedian),
      rate: `${r.successRate}%`,
      n: r.n,
    }));
}
