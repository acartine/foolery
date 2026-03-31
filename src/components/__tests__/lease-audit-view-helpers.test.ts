import { describe, it, expect, vi } from "vitest";

// Mock agent-identity so we don't need full module resolution
vi.mock("@/lib/agent-identity", () => ({
  formatAgentOptionLabel: (opts: { provider?: string; model?: string }) =>
    [opts.provider, opts.model].filter(Boolean).join("/") || "",
}));

import {
  buildDateRange,
  buildQueueSeries,
  buildAgentRows,
  buildCombinedSeries,
  buildLeaderboard,
  discoverQueueTypes,
} from "@/components/lease-audit-view";
import type { LeaseAuditAggregate } from "@/lib/lease-audit";

// ── Factories ───────────────────────────────────────────────────────

function agg(
  overrides: Partial<LeaseAuditAggregate> & {
    provider?: string;
    model?: string;
  },
): LeaseAuditAggregate {
  return {
    agent: {
      provider: overrides.provider ?? "claude",
      model: overrides.model ?? "opus",
    },
    queueType: overrides.queueType ?? "planning",
    outcome: overrides.outcome ?? "claim",
    date: overrides.date ?? "2026-03-20",
    count: overrides.count ?? 1,
  };
}

// ── buildDateRange ──────────────────────────────────────────────────

describe("buildDateRange", () => {
  it("returns empty for empty input", () => {
    expect(buildDateRange([])).toEqual([]);
  });

  it("returns a single date for one input", () => {
    expect(buildDateRange(["2026-03-20"])).toEqual(["2026-03-20"]);
  });

  it("fills gaps between dates", () => {
    const result = buildDateRange(["2026-03-20", "2026-03-23"]);
    expect(result).toEqual([
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
      "2026-03-23",
    ]);
  });

  it("deduplicates input dates", () => {
    const result = buildDateRange(["2026-03-20", "2026-03-20", "2026-03-21"]);
    expect(result).toEqual(["2026-03-20", "2026-03-21"]);
  });
});

// ── buildQueueSeries ────────────────────────────────────────────────

describe("buildQueueSeries", () => {
  it("returns empty for no matching queue type", () => {
    const aggregates = [agg({ queueType: "planning" })];
    expect(buildQueueSeries(aggregates, "implementation")).toEqual([]);
  });

  it("calculates success rate from completed outcomes", () => {
    const aggregates = [
      agg({ queueType: "planning", outcome: "claim", count: 3 }),
      agg({ queueType: "planning", outcome: "success", count: 2 }),
      agg({ queueType: "planning", outcome: "fail", count: 2 }),
    ];
    const series = buildQueueSeries(aggregates, "planning");
    expect(series).toHaveLength(1);
    expect(series[0]!.points[0]!.value).toBe(50);
  });

  it("partitions by agent", () => {
    const aggregates = [
      agg({
        provider: "claude",
        model: "opus",
        queueType: "planning",
        outcome: "success",
        count: 2,
      }),
      agg({
        provider: "codex",
        model: "o3",
        queueType: "planning",
        outcome: "fail",
        count: 5,
      }),
    ];
    const series = buildQueueSeries(aggregates, "planning");
    expect(series).toHaveLength(2);
    const agents = series.map((s) => s.agent).sort();
    expect(agents).toEqual(["claude/opus", "codex/o3"]);
  });

  it("uses null for dates without completed claims", () => {
    const aggregates = [
      agg({
        date: "2026-03-20",
        queueType: "planning",
        outcome: "success",
        count: 1,
      }),
      agg({
        date: "2026-03-22",
        queueType: "planning",
        outcome: "success",
        count: 3,
      }),
      agg({
        date: "2026-03-22",
        queueType: "planning",
        outcome: "fail",
        count: 1,
      }),
    ];
    const series = buildQueueSeries(aggregates, "planning");
    expect(series).toHaveLength(1);
    const points = series[0]!.points;
    expect(points).toHaveLength(3); // 20, 21, 22
    expect(points[0]!.value).toBe(100); // 03-20
    expect(points[1]!.value).toBeNull(); // 03-21 no completed claims
    expect(points[2]!.value).toBe(75); // 03-22
  });

  it("uses full date range from all aggregates", () => {
    const aggregates = [
      agg({
        date: "2026-03-20",
        queueType: "planning",
        outcome: "success",
        count: 1,
      }),
      // Implementation aggregate extends the date range
      agg({ date: "2026-03-23", queueType: "implementation", outcome: "claim", count: 1 }),
    ];
    const series = buildQueueSeries(aggregates, "planning");
    expect(series).toHaveLength(1);
    // Should span 20..23 even though planning only has data on 20
    expect(series[0]!.points).toHaveLength(4);
  });
});

// ── buildAgentRows ──────────────────────────────────────────────────

describe("buildAgentRows", () => {
  it("returns empty for no aggregates", () => {
    expect(buildAgentRows([])).toEqual([]);
  });

  it("aggregates across dates into a single agent row", () => {
    const aggregates = [
      agg({ date: "2026-03-20", outcome: "claim", count: 2 }),
      agg({ date: "2026-03-21", outcome: "claim", count: 3 }),
      agg({ date: "2026-03-20", outcome: "success", count: 1 }),
      agg({ date: "2026-03-21", outcome: "fail", count: 1 }),
    ];
    const rows = buildAgentRows(aggregates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completed).toBe(2);
    expect(rows[0]!.successes).toBe(1);
    expect(rows[0]!.failures).toBe(1);
    expect(rows[0]!.successRate).toBe("50%");
  });

  it("aggregates completed claims across queue types", () => {
    const aggregates = [
      agg({ queueType: "planning", outcome: "success", count: 2 }),
      agg({ queueType: "implementation", outcome: "fail", count: 4 }),
    ];
    const rows = buildAgentRows(aggregates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completed).toBe(6);
  });

  it("sorts by highest completed count descending", () => {
    const aggregates = [
      agg({ provider: "claude", model: "haiku", outcome: "success", count: 1 }),
      agg({ provider: "claude", model: "opus", outcome: "success", count: 10 }),
    ];
    const rows = buildAgentRows(aggregates);
    expect(rows[0]!.agentDisplay).toBe("claude/opus");
    expect(rows[1]!.agentDisplay).toBe("claude/haiku");
  });

  it("shows dash for success rate when no outcomes", () => {
    const aggregates = [agg({ outcome: "claim", count: 5 })];
    const rows = buildAgentRows(aggregates);
    expect(rows[0]!.successRate).toBe("-");
  });

  it("rounds mixed completion ratios to whole percentages", () => {
    const aggregates = [
      agg({ outcome: "success", count: 2 }),
      agg({ outcome: "fail", count: 1 }),
    ];
    const rows = buildAgentRows(aggregates);
    expect(rows[0]!.completed).toBe(3);
    expect(rows[0]!.successRate).toBe("67%");
  });
});

// ── buildCombinedSeries ─────────────────────────────────────────────

describe("buildCombinedSeries", () => {
  it("returns empty for no completed outcomes", () => {
    const aggregates = [agg({ outcome: "claim", count: 5 })];
    expect(buildCombinedSeries(aggregates)).toEqual([]);
  });

  it("combines success/fail across all queue types", () => {
    const aggregates = [
      agg({ queueType: "planning", outcome: "success", count: 3 }),
      agg({ queueType: "implementation", outcome: "success", count: 1 }),
      agg({ queueType: "implementation", outcome: "fail", count: 1 }),
    ];
    const series = buildCombinedSeries(aggregates);
    expect(series).toHaveLength(1);
    // 4 successes out of 5 total = 80%
    expect(series[0]!.points[0]!.value).toBe(80);
  });

  it("partitions combined series by agent", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 2 }),
      agg({ provider: "codex", model: "o3", queueType: "implementation", outcome: "fail", count: 1 }),
    ];
    const series = buildCombinedSeries(aggregates);
    expect(series).toHaveLength(2);
    const agents = series.map((s) => s.agent).sort();
    expect(agents).toEqual(["claude/opus", "codex/o3"]);
  });

  it("uses null for dates with no completed claims for an agent", () => {
    const aggregates = [
      agg({ date: "2026-03-20", queueType: "planning", outcome: "success", count: 1 }),
      agg({ date: "2026-03-22", queueType: "implementation", outcome: "fail", count: 1 }),
    ];
    const series = buildCombinedSeries(aggregates);
    expect(series).toHaveLength(1);
    const points = series[0]!.points;
    expect(points).toHaveLength(3); // 20, 21, 22
    expect(points[0]!.value).toBe(100);
    expect(points[1]!.value).toBeNull();
    expect(points[2]!.value).toBe(0);
  });
});

// ── discoverQueueTypes ──────────────────────────────────────────────

describe("discoverQueueTypes", () => {
  it("returns empty for no aggregates", () => {
    expect(discoverQueueTypes([])).toEqual([]);
  });

  it("discovers all distinct queue types sorted", () => {
    const aggregates = [
      agg({ queueType: "implementation" }),
      agg({ queueType: "planning" }),
      agg({ queueType: "review" }),
      agg({ queueType: "planning" }),
    ];
    expect(discoverQueueTypes(aggregates)).toEqual([
      "implementation",
      "planning",
      "review",
    ]);
  });
});

// ── buildLeaderboard ────────────────────────────────────────────────

describe("buildLeaderboard: baseline behavior", () => {
  it("returns empty for no aggregates", () => {
    expect(buildLeaderboard([])).toEqual([]);
  });

  it("returns empty when only claim outcomes exist", () => {
    const aggregates = [agg({ outcome: "claim", count: 5 })];
    expect(buildLeaderboard(aggregates)).toEqual([]);
  });

  it("shows best agent per step with margin over mean", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 90 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 10 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 60 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "fail", count: 40 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.step).toBe("planning");
    expect(entries[0]!.bestAgent).toBe("claude/opus");
    expect(entries[0]!.bestRate).toBe("90%");
    // mean = (90 + 60) / 2 = 75, margin = 90 - 75 = +15%
    expect(entries[0]!.margin).toBe("+15%");
  });

  it("shows +0% margin when only one agent", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 50 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.bestAgent).toBe("claude/opus");
    // single agent: mean equals rate, margin = +0%
    expect(entries[0]!.margin).toBe("+0%");
  });

  it("creates separate entries for each step", () => {
    const aggregates = [
      agg({ queueType: "planning", outcome: "success", count: 30 }),
      agg({ queueType: "planning", outcome: "fail", count: 10 }),
      agg({ queueType: "implementation", outcome: "success", count: 50 }),
      agg({ queueType: "implementation", outcome: "fail", count: 10 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(2);
    const steps = entries.map((e) => e.step).sort();
    expect(steps).toEqual(["implementation", "planning"]);
  });
});

describe("buildLeaderboard: qualification thresholds", () => {
  it("breaks ties by total completed count", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 10 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 100 }),
    ];
    const entries = buildLeaderboard(aggregates);
    // Both 100% rate, but codex/o3 has more completed
    expect(entries[0]!.bestAgent).toBe("codex/o3");
    // mean = 100%, margin = +0%
    expect(entries[0]!.margin).toBe("+0%");
  });

  it("excludes entries with fewer than 10 attempts", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 9 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 0 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 15 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "fail", count: 5 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.bestAgent).toBe("codex/o3");
  });

  it("excludes entries with exactly 10 attempts and 25% success rate", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 10 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 30 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 20 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "fail", count: 5 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    // claude/opus has 25% success rate, should be excluded
    expect(entries[0]!.bestAgent).toBe("codex/o3");
    expect(entries[0]!.bestRate).toBe("80%");
  });

  it("includes entries with success rate greater than 25%", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 3 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 7 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 26 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "fail", count: 74 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    // claude/opus has 30% success rate, exactly 10 attempts, should be included
    expect(entries[0]!.bestAgent).toBe("claude/opus");
    expect(entries[0]!.bestRate).toBe("30%");
  });

  it("omits step when no qualified agents remain after filtering", () => {
    const aggregates = [
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 1 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 5 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(0);
  });
});

describe("buildLeaderboard: qualified leaderboard stats", () => {
  it("computes mean/margin/totalN from qualified entries only", () => {
    const aggregates = [
      // Low-signal agent that would skew stats if included
      agg({ provider: "claude", model: "haiku", queueType: "planning", outcome: "success", count: 1 }),
      agg({ provider: "claude", model: "haiku", queueType: "planning", outcome: "fail", count: 1 }),
      // Qualified agents
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 80 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 20 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 70 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "fail", count: 30 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    // haiku excluded (only 2 attempts)
    // mean = (80 + 70) / 2 = 75, best (opus 80%) margin = +5%
    expect(entries[0]!.margin).toBe("+5%");
    // totalN should be from qualified entries only: 100 + 100 = 200
    expect(entries[0]!.totalN).toBe(200);
  });

  it("excludes low-signal agents from runner-up consideration", () => {
    const aggregates = [
      // Low-signal agents
      agg({ provider: "claude", model: "haiku", queueType: "planning", outcome: "success", count: 2 }),
      agg({ provider: "claude", model: "haiku", queueType: "planning", outcome: "fail", count: 0 }),
      agg({ provider: "openai", model: "gpt-4", queueType: "planning", outcome: "success", count: 5 }),
      agg({ provider: "openai", model: "gpt-4", queueType: "planning", outcome: "fail", count: 5 }),
      // Qualified agents
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "success", count: 90 }),
      agg({ provider: "claude", model: "opus", queueType: "planning", outcome: "fail", count: 10 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "success", count: 80 }),
      agg({ provider: "codex", model: "o3", queueType: "planning", outcome: "fail", count: 20 }),
    ];
    const entries = buildLeaderboard(aggregates);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.bestAgent).toBe("claude/opus");
    // runner-up should be codex/o3, not haiku or gpt-4
    expect(entries[0]!.runnerUp).toBe("codex/o3");
    expect(entries[0]!.runnerUpRate).toBe("80%");
  });
});
