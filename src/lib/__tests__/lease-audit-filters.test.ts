import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LeaseAuditEvent } from "@/lib/lease-audit";

// We need to import applyFilters from the route, but it depends on Next.js
// modules. Mock the heavy deps so we can import just the function.
vi.mock("@/lib/lease-audit", () => ({
  readLeaseAuditEvents: vi.fn(),
  aggregateLeaseAudit: vi.fn(),
  resolveAuditLogRoots: vi.fn(),
}));
vi.mock("@/lib/agent-outcome-stats", () => ({
  resolveStatsPath: vi.fn(() => "/tmp/stats.jsonl"),
}));

import { applyFilters } from "@/app/api/lease-audit/route";

function makeEvent(overrides: Partial<LeaseAuditEvent> = {}): LeaseAuditEvent {
  return {
    timestamp: "2026-03-20T12:00:00.000Z",
    beatId: "beat-1",
    sessionId: "session-1",
    agent: { provider: "Claude", model: "opus" },
    queueType: "planning",
    outcome: "claim",
    ...overrides,
  };
}

describe("applyFilters", () => {
  describe("manual date range", () => {
    it("filters by dateFrom (date-granular)", () => {
      const events = [
        makeEvent({ timestamp: "2026-03-19T23:59:59Z" }),
        makeEvent({ timestamp: "2026-03-20T00:00:01Z" }),
      ];
      const result = applyFilters(events, { dateFrom: "2026-03-20" });
      expect(result).toHaveLength(1);
      expect(result[0]!.timestamp).toBe("2026-03-20T00:00:01Z");
    });

    it("filters by dateTo (date-granular)", () => {
      const events = [
        makeEvent({ timestamp: "2026-03-20T23:59:59Z" }),
        makeEvent({ timestamp: "2026-03-21T00:00:01Z" }),
      ];
      const result = applyFilters(events, { dateTo: "2026-03-20" });
      expect(result).toHaveLength(1);
      expect(result[0]!.timestamp).toBe("2026-03-20T23:59:59Z");
    });

    it("filters by both dateFrom and dateTo", () => {
      const events = [
        makeEvent({ timestamp: "2026-03-19T10:00:00Z" }),
        makeEvent({ timestamp: "2026-03-20T10:00:00Z" }),
        makeEvent({ timestamp: "2026-03-21T10:00:00Z" }),
        makeEvent({ timestamp: "2026-03-22T10:00:00Z" }),
      ];
      const result = applyFilters(events, {
        dateFrom: "2026-03-20",
        dateTo: "2026-03-21",
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("last24h preset", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-21T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps only events within the last 24 hours", () => {
      const events = [
        makeEvent({ timestamp: "2026-03-20T11:59:59Z" }), // just outside
        makeEvent({ timestamp: "2026-03-20T12:00:01Z" }), // just inside
        makeEvent({ timestamp: "2026-03-21T11:00:00Z" }), // inside
      ];
      const result = applyFilters(events, { preset: "last24h" });
      expect(result).toHaveLength(2);
      expect(result[0]!.timestamp).toBe("2026-03-20T12:00:01Z");
      expect(result[1]!.timestamp).toBe("2026-03-21T11:00:00Z");
    });

    it("preset takes precedence over manual dateFrom/dateTo", () => {
      const events = [
        makeEvent({ timestamp: "2026-03-19T10:00:00Z" }), // matches dateFrom but not preset
        makeEvent({ timestamp: "2026-03-21T10:00:00Z" }), // matches preset
      ];
      const result = applyFilters(events, {
        preset: "last24h",
        dateFrom: "2026-03-19",
        dateTo: "2026-03-22",
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.timestamp).toBe("2026-03-21T10:00:00Z");
    });

    it("returns empty when no events in last 24 hours", () => {
      const events = [
        makeEvent({ timestamp: "2026-03-19T10:00:00Z" }),
      ];
      const result = applyFilters(events, { preset: "last24h" });
      expect(result).toEqual([]);
    });
  });

  describe("other filters", () => {
    it("filters by queueType", () => {
      const events = [
        makeEvent({ queueType: "planning" }),
        makeEvent({ queueType: "implementation" }),
      ];
      const result = applyFilters(events, { queueType: "planning" });
      expect(result).toHaveLength(1);
      expect(result[0]!.queueType).toBe("planning");
    });

    it("passes through all events when no filters set", () => {
      const events = [makeEvent(), makeEvent()];
      const result = applyFilters(events, {});
      expect(result).toHaveLength(2);
    });
  });
});
