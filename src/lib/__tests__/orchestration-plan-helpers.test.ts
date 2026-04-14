import { describe, expect, it } from "vitest";

import {
  buildPrompt,
  derivePromptScope,
  normalizePlan,
} from "@/lib/orchestration-plan-helpers";
import type { Beat } from "@/lib/types";

function makeBeat(
  input: Partial<Beat> & Pick<Beat, "id" | "title">,
): Beat {
  return {
    id: input.id,
    title: input.title,
    type: input.type ?? "work",
    state: input.state ?? "open",
    priority: input.priority ?? 2,
    labels: input.labels ?? [],
    created: input.created ?? "2026-04-14T00:00:00Z",
    updated: input.updated ?? "2026-04-14T00:00:00Z",
    description: input.description,
  };
}

describe("orchestration-plan-helpers", () => {
  it("includes dependency edges and groom guidance in the prompt", () => {
    const beats = [
      makeBeat({
        id: "beat-1",
        title: "Refactor API",
        description: "Touches src/api/plan.ts and src/api/route.ts",
      }),
      makeBeat({
        id: "beat-2",
        title: "Update tests",
        description: "Touches src/api/route.ts and test coverage",
      }),
    ];
    const scope = derivePromptScope(
      beats,
      "Plan beat-1 and beat-2 together",
    );

    const prompt = buildPrompt(
      "/repo",
      scope.scopedBeats,
      scope.unresolvedScopeIds,
      [{ blockerId: "beat-1", blockedId: "beat-2" }],
      "Plan beat-1 and beat-2 together",
      "groom",
    );

    expect(prompt).toContain("Planning mode: groom");
    expect(prompt).toContain("beat-1 blocks beat-2");
    expect(prompt).toContain("description: Touches src/api/plan.ts");
    expect(prompt).toContain("Group beats that touch the same files");
    expect(prompt).toContain('"steps":[{"step_index":1,"beat_ids":["..."]}]');
  });

  it("normalizes explicit steps and backfills implicit step groups", () => {
    const beatTitleMap = new Map([
      ["beat-1", "Beat 1"],
      ["beat-2", "Beat 2"],
      ["beat-3", "Beat 3"],
    ]);

    const plan = normalizePlan(
      {
        summary: "Plan",
        waves: [
          {
            wave_index: 1,
            name: "Wave 1",
            objective: "Do work",
            beats: [
              { id: "beat-1", title: "Beat 1" },
              { id: "beat-2", title: "Beat 2" },
            ],
            steps: [
              {
                step_index: 2,
                beat_ids: ["beat-2"],
              },
              {
                step_index: 1,
                beat_ids: ["beat-1"],
              },
            ],
          },
          {
            wave_index: 2,
            name: "Wave 2",
            objective: "More work",
            beats: [{ id: "beat-3", title: "Beat 3" }],
          },
        ],
        unassigned_beat_ids: [],
        assumptions: [],
      },
      beatTitleMap,
    );

    expect(plan).not.toBeNull();
    expect(plan?.waves[0]?.steps).toEqual([
      { stepIndex: 1, beatIds: ["beat-1"], notes: undefined },
      { stepIndex: 2, beatIds: ["beat-2"], notes: undefined },
    ]);
    expect(plan?.waves[1]?.steps).toEqual([
      { stepIndex: 1, beatIds: ["beat-3"] },
    ]);
  });
});
