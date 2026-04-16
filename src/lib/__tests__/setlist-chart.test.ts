import { describe, expect, it } from "vitest";
import { buildSetlistChart, buildSetlistPlanPreview } from "@/lib/setlist-chart";
import type { PlanDocument, PlanSummary } from "@/lib/orchestration-plan-types";
import type { Beat } from "@/lib/types";

function makeBeat(
  id: string,
  overrides: Partial<Beat> = {},
): Beat {
  return {
    id,
    title: `Beat ${id}`,
    type: "work",
    state: "ready_for_implementation",
    priority: 2,
    labels: [],
    created: "2026-04-16T00:00:00.000Z",
    updated: "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(): PlanDocument {
  return {
    repoPath: "/tmp/repo",
    beatIds: ["beat-next", "beat-last", "beat-wave-fallback"],
    summary: "Launch setlist view",
    waves: [
      {
        waveIndex: 1,
        name: "Prep",
        objective: "Set up the first change.",
        agents: [],
        beats: [
          { id: "beat-next", title: "Wire navigation" },
          { id: "beat-wave-fallback", title: "Wave-only beat" },
        ],
        steps: [
          {
            stepIndex: 1,
            beatIds: ["beat-next"],
            notes: "Wire the nav first.",
          },
        ],
      },
      {
        waveIndex: 2,
        name: "Render",
        objective: "Ship the chart.",
        agents: [],
        beats: [
          { id: "beat-last", title: "Draw gantt chart" },
        ],
        steps: [
          {
            stepIndex: 1,
            beatIds: ["beat-last"],
            notes: "Render the final chart slot.",
          },
        ],
      },
    ],
    unassignedBeatIds: [],
    assumptions: [],
  };
}

function makeParallelPlan(): PlanDocument {
  return {
    repoPath: "/tmp/repo",
    beatIds: ["beat-a", "beat-b", "beat-c"],
    summary: "Parallel setlist view",
    waves: [
      {
        waveIndex: 1,
        name: "Parallel wave",
        objective: "Run two knots together.",
        agents: [],
        beats: [
          { id: "beat-a", title: "Beat A" },
          { id: "beat-b", title: "Beat B" },
          { id: "beat-c", title: "Beat C" },
        ],
        steps: [
          {
            stepIndex: 1,
            beatIds: ["beat-a", "beat-b"],
            notes: "Run these together.",
          },
          {
            stepIndex: 2,
            beatIds: ["beat-c"],
          },
        ],
      },
    ],
    unassignedBeatIds: [],
    assumptions: [],
  };
}

describe("setlist chart helpers", () => {
  it("builds one slot per scheduled knot and orders rows by execution order", () => {
    const plan = makePlan();
    const beatMap = new Map<string, Beat>([
      ["beat-next", makeBeat("beat-next", { priority: 0, description: "Top lane" })],
      ["beat-last", makeBeat("beat-last", { priority: 4, description: "Bottom lane" })],
      ["beat-wave-fallback", makeBeat("beat-wave-fallback", { priority: 1 })],
    ]);

    const chart = buildSetlistChart(plan, beatMap);

    expect(chart.slots).toHaveLength(3);
    expect(chart.slots.map((slot) => slot.waveLabel)).toEqual([
      "Wave 1",
      "Wave 1",
      "Wave 2",
    ]);
    expect(chart.rows.map((row) => row.rankLabel)).toEqual([
      "Next",
      "#2",
      "Last",
    ]);
    expect(chart.rows[0]!.cells[0]?.beatId).toBe("beat-next");
    expect(chart.rows[1]!.cells[1]?.beatId).toBe("beat-wave-fallback");
    expect(chart.rows[2]!.cells[2]?.beatId).toBe("beat-last");
  });

  it("uses knot ids when previewing execution plans", () => {
    const summary: PlanSummary = {
      artifact: {
        id: "plan-1",
        type: "execution_plan",
        state: "ready_for_design",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
      },
      plan: {
        repoPath: "/tmp/repo",
        beatIds: ["beat-next", "beat-last"],
        summary: "Plan summary",
        objective: "Plan objective",
      },
    };
    const beatMap = new Map<string, Beat>([
      ["beat-next", makeBeat("beat-next", { description: "First description" })],
      ["beat-last", makeBeat("beat-last", { description: "Second description" })],
    ]);

    const preview = buildSetlistPlanPreview(summary, beatMap);

    expect(preview.previewBeats[0]).toMatchObject({
      id: "beat-next",
      label: "beat-next",
    });
    expect(preview.totalBeats).toBe(2);
  });

  it("includes step notes on the scheduled chart cell", () => {
    const chart = buildSetlistChart(makePlan(), new Map());

    expect(chart.rows[0]!.cells[0]).toMatchObject({
      notes: "Wire the nav first.",
    });
  });

  it("uses knot ids instead of plan-derived titles when live beat data is missing", () => {
    const chart = buildSetlistChart(makePlan(), new Map());

    expect(chart.rows[0]!.beatLabel).toBe("beat-next");
    expect(chart.rows[0]!.title).toBe("beat-next");
    expect(chart.rows[1]!.beatLabel).toBe("beat-wave-fallback");
    expect(chart.rows[1]!.title).toBe("beat-wave-fallback");
    expect(chart.rows[0]!.cells[0]).toMatchObject({
      beatLabel: "beat-next",
      title: "beat-next",
    });
  });

  it("aligns parallel knots to the same horizontal span", () => {
    const chart = buildSetlistChart(makeParallelPlan(), new Map());

    expect(chart.slots).toHaveLength(2);
    expect(chart.rows[0]!.cells[0]).toMatchObject({
      beatId: "beat-a",
      span: 1,
      notes: "Run these together.",
    });
    expect(chart.rows[1]!.cells[0]).toMatchObject({
      beatId: "beat-b",
      span: 1,
      notes: "Run these together.",
    });
    expect(chart.rows[2]!.cells[1]).toMatchObject({
      beatId: "beat-c",
      span: 1,
    });
  });
});
