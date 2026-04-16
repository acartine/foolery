import { describe, expect, it } from "vitest";
import { mapExecutionPlanDocument } from "@/lib/orchestration-plan-payload";
import type { KnotRecord } from "@/lib/knots";

describe("orchestration plan payload normalization", () => {
  it("supports native execution plans that store knot_ids", () => {
    const record = {
      id: "foolery-79a3",
      title: "Plan",
      state: "ready_for_review",
      updated_at: "2026-04-16T00:00:00Z",
      type: "execution_plan",
      execution_plan: {
        repo_path: "/repo",
        summary: "Summary",
        knot_ids: ["beat-1", "beat-2"],
        waves: [
          {
            wave_index: 1,
            name: "Wave 1",
            steps: [
              {
                step_index: 1,
                knot_ids: ["beat-1"],
                notes: "Step one",
              },
              {
                step_index: 2,
                knot_ids: ["beat-2"],
                notes: "Step two",
              },
            ],
          },
        ],
      },
    } satisfies KnotRecord;

    const plan = mapExecutionPlanDocument(record);

    expect(plan?.beatIds).toEqual(["beat-1", "beat-2"]);
    expect(plan?.waves[0]?.beats).toEqual([
      { id: "beat-1", title: "beat-1" },
      { id: "beat-2", title: "beat-2" },
    ]);
    expect(plan?.waves[0]?.steps).toEqual([
      {
        stepIndex: 1,
        beatIds: ["beat-1"],
        notes: "Step one",
      },
      {
        stepIndex: 2,
        beatIds: ["beat-2"],
        notes: "Step two",
      },
    ]);
  });
});
