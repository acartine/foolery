import { describe, expect, it } from "vitest";
import {
  buildSetlistChart,
  buildSetlistChartViewport,
  buildSetlistPlanPreview,
  countWorkableBeatIds,
  countWorkableSetlistRows,
  isTerminalPlanArtifactState,
  isTerminalSetlistState,
  sliceSetlistChart,
} from "@/lib/setlist-chart";
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

function makeWindowedPlan(stepCount: number): PlanDocument {
  const beatIds = Array.from(
    { length: stepCount },
    (_, index) => `beat-${index + 1}`,
  );

  return {
    repoPath: "/tmp/repo",
    beatIds,
    summary: "Windowed setlist view",
    waves: [
      {
        waveIndex: 1,
        name: "Windowed wave",
        objective: "Step through pages of work.",
        agents: [],
        beats: beatIds.map((beatId) => ({
          id: beatId,
          title: `Beat ${beatId}`,
        })),
        steps: beatIds.map((beatId, index) => ({
          stepIndex: index + 1,
          beatIds: [beatId],
          notes: `Schedule ${beatId}`,
        })),
      },
    ],
    unassignedBeatIds: [],
    assumptions: [],
  };
}

function makeWindowedBeatMap(
  stepCount: number,
  getState: (index: number) => Beat["state"],
): Map<string, Beat> {
  return new Map(
    Array.from({ length: stepCount }, (_, index) => {
      const beatId = `beat-${index + 1}`;
      return [
        beatId,
        makeBeat(beatId, {
          title: `Beat ${beatId}`,
          state: getState(index),
        }),
      ];
    }),
  );
}

describe("setlist chart helpers: scheduled rows", () => {
  it("builds one slot per scheduled knot and orders rows by execution order", () => {
    const plan = makePlan();
    const beatMap = new Map<string, Beat>([
      ["beat-next", makeBeat("beat-next", {
        title: "Wire navigation",
        priority: 0,
        description: "Top lane",
      })],
      ["beat-last", makeBeat("beat-last", {
        title: "Draw gantt chart",
        priority: 4,
        description: "Bottom lane",
      })],
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
    expect(chart.rows[0]!.title).toBe("Wire navigation");
    expect(chart.rows[0]!.cells[0]?.beatId).toBe("beat-next");
    expect(chart.rows[0]!.cells[0]?.title).toBe("Wire navigation");
    expect(chart.rows[1]!.cells[1]?.beatId).toBe("beat-wave-fallback");
    expect(chart.rows[2]!.cells[2]?.beatId).toBe("beat-last");
  });

  it("excludes orphaned plan beat ids from scheduled rows", () => {
    const chart = buildSetlistChart(
      {
        ...makePlan(),
        beatIds: ["beat-next", "beat-last", "beat-wave-fallback", "beat-orphan"],
      },
      new Map(),
    );

    expect(chart.rows.map((row) => row.beatId)).toEqual([
      "beat-next",
      "beat-wave-fallback",
      "beat-last",
    ]);
  });
});

describe("setlist chart helpers: preview data", () => {
  it("uses real knot titles when previewing execution plans", () => {
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
      ["beat-next", makeBeat("beat-next", { title: "First title" })],
      ["beat-last", makeBeat("beat-last", { title: "Second title" })],
    ]);

    const preview = buildSetlistPlanPreview(summary, beatMap);

    expect(preview.previewBeats[0]).toMatchObject({
      id: "beat-next",
      label: "beat-next",
      title: "First title",
    });
    expect(preview.totalBeats).toBe(2);
  });
});

describe("setlist chart helpers: display fallbacks", () => {
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

  it("counts only non-terminal scheduled rows as remaining", () => {
    const chart = buildSetlistChart(
      makePlan(),
      new Map<string, Beat>([
        ["beat-next", makeBeat("beat-next", { state: "ready_for_implementation" })],
        ["beat-last", makeBeat("beat-last", { state: "shipped" })],
        ["beat-wave-fallback", makeBeat("beat-wave-fallback", { state: "abandoned" })],
      ]),
    );

    expect(countWorkableSetlistRows(chart)).toBe(1);
  });

  it("treats shipped, abandoned, and closed as terminal setlist states", () => {
    expect(isTerminalSetlistState("shipped")).toBe(true);
    expect(isTerminalSetlistState("abandoned")).toBe(true);
    expect(isTerminalSetlistState("closed")).toBe(true);
    expect(isTerminalSetlistState("ready_for_implementation")).toBe(false);
    expect(isTerminalSetlistState(undefined)).toBe(false);
  });

  it("treats only shipped and abandoned as terminal plan-artifact states", () => {
    expect(isTerminalPlanArtifactState("shipped")).toBe(true);
    expect(isTerminalPlanArtifactState("abandoned")).toBe(true);
    expect(isTerminalPlanArtifactState("blocked")).toBe(false);
    expect(isTerminalPlanArtifactState("deferred")).toBe(false);
    expect(isTerminalPlanArtifactState("design")).toBe(false);
    expect(isTerminalPlanArtifactState(undefined)).toBe(false);
  });

  it("counts non-terminal beats from a beat list against a beat map", () => {
    const beatMap = new Map<string, Beat>([
      ["beat-1", makeBeat("beat-1", { state: "shipped" })],
      ["beat-2", makeBeat("beat-2", { state: "ready_for_implementation" })],
      ["beat-3", makeBeat("beat-3", { state: "abandoned" })],
      ["beat-4", makeBeat("beat-4", { state: "in_progress" })],
    ]);

    expect(
      countWorkableBeatIds(
        ["beat-1", "beat-2", "beat-3", "beat-4"],
        beatMap,
      ),
    ).toBe(2);
  });

  it("ignores duplicate and unknown beat ids when counting workable beats", () => {
    const beatMap = new Map<string, Beat>([
      ["beat-1", makeBeat("beat-1", { state: "ready_for_implementation" })],
    ]);

    expect(
      countWorkableBeatIds(
        ["beat-1", "beat-1", "beat-missing", ""],
        beatMap,
      ),
    ).toBe(2);
  });

  it("flags cells whose beats have an active lease", () => {
    const chart = buildSetlistChart(
      makePlan(),
      new Map<string, Beat>([
        ["beat-next", makeBeat("beat-next", { title: "Wire navigation" })],
        ["beat-last", makeBeat("beat-last", { title: "Draw gantt chart" })],
      ]),
      { activeBeatIds: new Set(["beat-next"]) },
    );

    expect(chart.rows[0]!.cells[0]?.isActiveLease).toBe(true);
    expect(chart.rows[2]!.cells[2]?.isActiveLease).toBe(false);
  });
});

describe("setlist chart helpers: viewport", () => {
  it("shifts leading completed steps off-screen when there is room", () => {
    const chart = buildSetlistChart(
      makeWindowedPlan(15),
      makeWindowedBeatMap(
        15,
        (index) => index < 2 ? "shipped" : "ready_for_implementation",
      ),
    );

    const viewport = buildSetlistChartViewport(chart);
    const window = sliceSetlistChart(
      chart,
      viewport.initialSlotStart,
      viewport.pageSize,
    );

    expect(viewport.initialSlotStart).toBe(2);
    expect(viewport.maxSlotStart).toBe(3);
    expect(window.rows).toHaveLength(12);
    expect(window.rows[0]!.cells[0]?.beatId).toBe("beat-3");
  });

  it("biases toward the next unfinished step near the tail of the chart", () => {
    const chart = buildSetlistChart(
      makeWindowedPlan(15),
      makeWindowedBeatMap(
        15,
        (index) => index < 12 ? "shipped" : "ready_for_implementation",
      ),
    );

    const viewport = buildSetlistChartViewport(chart);
    const window = sliceSetlistChart(
      chart,
      viewport.initialSlotStart,
      viewport.pageSize,
    );

    expect(viewport.initialSlotStart).toBe(3);
    expect(viewport.maxSlotStart).toBe(3);
    expect(window.rows).toHaveLength(12);
    expect(window.rows[0]!.cells[0]?.beatId).toBe("beat-4");
    expect(window.rows[9]!.cells[9]?.beatId).toBe("beat-13");
  });

  it("falls back to the last page when every beat is terminal", () => {
    const chart = buildSetlistChart(
      makeWindowedPlan(25),
      makeWindowedBeatMap(25, () => "shipped"),
    );

    const viewport = buildSetlistChartViewport(chart);
    const window = sliceSetlistChart(
      chart,
      viewport.initialSlotStart,
      viewport.pageSize,
    );

    expect(viewport.initialSlotStart).toBe(13);
    expect(viewport.maxSlotStart).toBe(13);
    expect(window.rows[0]!.cells[0]?.beatId).toBe("beat-14");
    expect(window.rows[11]!.cells[11]?.beatId).toBe("beat-25");
  });

  it("keeps a single page when the chart has at most twelve steps", () => {
    const chart = buildSetlistChart(
      makeWindowedPlan(12),
      makeWindowedBeatMap(
        12,
        (index) => index < 4 ? "shipped" : "ready_for_implementation",
      ),
    );

    const viewport = buildSetlistChartViewport(chart);
    const window = sliceSetlistChart(
      chart,
      viewport.initialSlotStart,
      viewport.pageSize,
    );

    expect(viewport.maxSlotStart).toBe(0);
    expect(viewport.initialSlotStart).toBe(0);
    expect(window.rows).toHaveLength(12);
    expect(window.rows[11]!.cells[11]?.beatId).toBe("beat-12");
  });
});
