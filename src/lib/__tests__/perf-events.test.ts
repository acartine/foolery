import { describe, expect, it } from "vitest";
import {
  buildPerfMeasureName,
  createPerfEvent,
  parsePerfMeasureName,
  summarizeClientPerfEvents,
  type ClientPerfEvent,
} from "@/lib/perf-events";

describe("perf-events", () => {
  it("round-trips measure names", () => {
    const name = buildPerfMeasureName("query", "beats:list", "abc123");
    expect(parsePerfMeasureName(name)).toEqual({
      category: "query",
      label: "beats:list",
      spanId: "abc123",
    });
  });

  it("summarizes event totals by kind", () => {
    const events: ClientPerfEvent[] = [
      createPerfEvent({
        kind: "long_task",
        durationMs: 80,
      }),
      createPerfEvent({
        kind: "query_timing",
        label: "beats:list",
        durationMs: 22,
        ok: true,
      }),
      createPerfEvent({
        kind: "render_commit",
        profilerId: "beat-table",
        phase: "mount",
        actualDurationMs: 12,
        baseDurationMs: 15,
        startTimeMs: 1,
        commitTimeMs: 2,
      }),
    ];

    const summary = summarizeClientPerfEvents(events);
    expect(summary.totalEvents).toBe(3);
    expect(summary.counts.long_task).toBe(1);
    expect(summary.counts.query_timing).toBe(1);
    expect(summary.totalLongTaskMs).toBe(80);
    expect(summary.totalRenderCommitMs).toBe(12);
  });
});
