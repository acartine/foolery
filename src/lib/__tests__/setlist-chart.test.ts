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
          },
        ],
      },
    ],
    unassignedBeatIds: [],
    assumptions: [],
  };
}

describe("setlist chart helpers", () => {
  it("builds equal-width slots and orders lanes from next to last", () => {
    const plan = makePlan();
    const beatMap = new Map<string, Beat>([
      ["beat-next", makeBeat("beat-next", { priority: 0, description: "Top lane" })],
      ["beat-last", makeBeat("beat-last", { priority: 4, description: "Bottom lane" })],
      ["beat-wave-fallback", makeBeat("beat-wave-fallback", { priority: 1 })],
    ]);

    const chart = buildSetlistChart(plan, beatMap);

    expect(chart.slots).toHaveLength(2);
    expect(chart.lanes.map((lane) => lane.label)).toEqual([
      "Next",
      "Soon",
      "Queued",
      "Later",
      "Last",
    ]);
    expect(chart.lanes[0]!.cells[0]![0]!.beatId).toBe("beat-next");
    expect(chart.lanes[1]!.cells[0]![0]!.beatId).toBe("beat-wave-fallback");
    expect(chart.lanes[4]!.cells[1]![0]!.beatId).toBe("beat-last");
  });

  it("uses beat descriptions when previewing execution plans", () => {
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
      description: "First description",
    });
    expect(preview.totalBeats).toBe(2);
  });
});
