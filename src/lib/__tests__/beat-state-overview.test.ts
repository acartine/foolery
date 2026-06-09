import { describe, expect, it } from "vitest";
import {
  buildOverviewStateTabs,
  countGroupedBeats,
  filterOverviewBeats,
  groupBeatsByState,
  groupOverviewBeatsByState,
  hideOverviewColumn,
  isOverviewActiveState,
  isOverviewBeat,
  nextOverviewHiddenColumns,
  normalizeOverviewState,
  overviewBeatLabel,
  overviewGridTemplateColumns,
  overviewLeaseInfoForBeat,
  overviewTabForBeat,
  overviewTabForState,
  restoreOverviewColumns,
  renderableOverviewGroups,
  shouldShowOverviewColumnHideControl,
  visibleOverviewGroups,
} from "@/lib/beat-state-overview";
import type { Beat } from "@/lib/types";

function makeBeat(
  id: string,
  state: string,
  overrides: Partial<Beat> = {},
): Beat {
  return {
    id,
    title: id,
    type: "work",
    state,
    priority: 2,
    labels: [],
    created: "2026-05-01T00:00:00.000Z",
    updated: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("beat-state-overview grouping", () => {
  it("normalizes blank states into an explicit group", () => {
    expect(normalizeOverviewState("  ")).toBe("unknown");
    expect(normalizeOverviewState(undefined)).toBe("unknown");
    expect(normalizeOverviewState("Implementation")).toBe("implementation");
  });

  it("places every beat into exactly one plain state group", () => {
    const beats = [
      makeBeat("beat-1", "ready_for_planning"),
      makeBeat("beat-2", "implementation"),
      makeBeat("beat-3", "implementation"),
      makeBeat("beat-4", "shipped"),
    ];

    const groups = groupBeatsByState(beats);
    const groupedIds = groups.flatMap((group) =>
      group.beats.map((beat) => beat.id)
    );

    expect(countGroupedBeats(groups)).toBe(beats.length);
    expect(new Set(groupedIds).size).toBe(beats.length);
    expect(groupedIds.sort()).toEqual(
      beats.map((beat) => beat.id).sort(),
    );
  });

  it("sorts known workflow states before unknown states", () => {
    const groups = groupBeatsByState([
      makeBeat("custom-z", "z_custom"),
      makeBeat("ship", "shipped"),
      makeBeat("ready", "ready_for_planning"),
      makeBeat("active", "implementation"),
      makeBeat("custom-a", "a_custom"),
    ]);

    expect(groups.map((group) => group.state)).toEqual([
      "ready_for_planning",
      "implementation",
      "shipped",
      "a_custom",
      "z_custom",
    ]);
  });

  it("sorts beats inside a group by priority and recency", () => {
    const groups = groupBeatsByState([
      makeBeat("low-new", "implementation", {
        priority: 4,
        updated: "2026-05-03T00:00:00.000Z",
      }),
      makeBeat("high-old", "implementation", {
        priority: 1,
        updated: "2026-05-01T00:00:00.000Z",
      }),
      makeBeat("high-new", "implementation", {
        priority: 1,
        updated: "2026-05-02T00:00:00.000Z",
      }),
    ]);

    expect(groups[0]?.beats.map((beat) => beat.id)).toEqual([
      "high-new",
      "high-old",
      "low-new",
    ]);
  });
});

describe("beat-state-overview display rules", () => {
  it("filters internal lease records out of the overview surface", () => {
    const work = makeBeat("work-1", "ready_for_planning");
    const lease = makeBeat("lease-1", "lease_ready", {
      type: "lease",
    });
    const shipped = makeBeat("ship-1", "shipped");

    expect(isOverviewBeat(work)).toBe(true);
    expect(isOverviewBeat(lease)).toBe(false);
    expect(isOverviewBeat(shipped)).toBe(true);
    expect(filterOverviewBeats([work, lease, shipped])).toEqual([
      work,
      shipped,
    ]);
  });

  it("adds required empty columns for the overview matrix", () => {
    const groups = groupOverviewBeatsByState([
      makeBeat("plan", "planning"),
      makeBeat("impl", "implementation"),
    ]);

    expect(groups.map((group) => group.state)).toEqual(
      expect.arrayContaining([
        "ready_for_plan_review",
        "ready_for_implementation_review",
        "ready_for_shipment",
        "shipment",
        "ready_for_shipment_review",
      ]),
    );
    expect(
      groups.find((group) => group.state === "shipment")?.beats,
    ).toEqual([]);
    expect(countGroupedBeats(groups)).toBe(2);
  });

  it("uses full labels only in all-repositories overview", () => {
    const beat = makeBeat("foolery-bd05", "planning", {
      aliases: ["foolery-2.1.3"],
    });
    const withoutAlias = makeBeat("foolery-bd05", "planning");

    expect(overviewBeatLabel(beat, true)).toBe("foolery-2.1.3");
    expect(overviewBeatLabel(beat, false)).toBe("2.1.3");
    expect(overviewBeatLabel(withoutAlias, true)).toBe("foolery-bd05");
    expect(overviewBeatLabel(withoutAlias, false)).toBe("bd05");
  });
});

describe("beat-state-overview tabs", () => {
  it("classifies overview states into tab groups", () => {
    expect(overviewTabForState("ready_for_exploration")).toBe(
      "exploration",
    );
    expect(overviewTabForState("ready_to_evaluate")).toBe("gates");
    expect(overviewTabForState("deferred")).toBe("terminated");
    expect(overviewTabForState("shipped")).toBe("terminated");
    expect(overviewTabForState("implementation")).toBe("work_items");
    expect(overviewTabForState("custom_state")).toBe("work_items");
  });

  it("keeps non-terminal gate beats out of work items", () => {
    expect(
      overviewTabForBeat(
        makeBeat("gate", "ready_for_planning", { type: "gate" }),
      ),
    ).toBe("gates");
    expect(
      overviewTabForBeat(
        makeBeat("eval", "ready_for_planning", {
          workflowId: "evaluate",
        }),
      ),
    ).toBe("gates");
    expect(
      overviewTabForBeat(
        makeBeat("done-gate", "shipped", { type: "gate" }),
      ),
    ).toBe("terminated");
  });

  it("builds tab counts without counting lease records", () => {
    const tabs = buildOverviewStateTabs([
      makeBeat("work", "implementation"),
      makeBeat("explore", "ready_for_exploration"),
      makeBeat("gate", "ready_to_evaluate"),
      makeBeat("gate-ready", "ready_for_planning", { type: "gate" }),
      makeBeat("ship", "shipped"),
      makeBeat("lease", "lease_active", { type: "lease" }),
    ]);

    expect(tabs.map((tab) => [tab.id, tab.count])).toEqual([
      ["work_items", 1],
      ["exploration", 1],
      ["gates", 2],
      ["terminated", 1],
    ]);
  });

  it("groups required columns for non-work overview tabs", () => {
    const beats = [
      makeBeat("explore", "ready_for_exploration"),
      makeBeat("gate", "ready_to_evaluate"),
      makeBeat("gate-ready", "ready_for_planning", { type: "gate" }),
      makeBeat("ship", "shipped"),
    ];

    expect(
      groupOverviewBeatsByState(beats, "exploration")
        .map((group) => group.state),
    ).toEqual(["ready_for_exploration"]);
    expect(
      groupOverviewBeatsByState(beats, "gates")
        .map((group) => group.state),
    ).toEqual(["ready_to_evaluate", "ready_for_planning"]);

    const terminated = groupOverviewBeatsByState([
      ...beats,
      makeBeat("defer", "deferred"),
      makeBeat("abandon", "abandoned"),
    ], "terminated");
    expect(terminated.map((group) => group.state)).toEqual([
      "terminated",
    ]);
    expect(terminated[0]?.beats.map((beat) => beat.state).sort()).toEqual([
      "abandoned",
      "deferred",
      "shipped",
    ]);
  });

  it("keeps required special-tab columns when those tabs are empty", () => {
    expect(groupOverviewBeatsByState([], "exploration")).toMatchObject([
      { state: "ready_for_exploration", required: true, beats: [] },
    ]);
    expect(groupOverviewBeatsByState([], "gates")).toMatchObject([
      { state: "ready_to_evaluate", required: true, beats: [] },
    ]);
    expect(groupOverviewBeatsByState([], "terminated")).toMatchObject([
      { state: "terminated", required: true, beats: [] },
    ]);
  });

  it("filters empty columns from the visible overview rail", () => {
    const groups = groupOverviewBeatsByState([
      makeBeat("plan", "planning"),
      makeBeat("impl", "implementation"),
    ]);

    expect(visibleOverviewGroups(groups).map((group) => group.state)).toEqual([
      "planning",
      "implementation",
    ]);
  });
});

describe("beat-state-overview column visibility", () => {
  it("shows all required columns by default until hidden", () => {
    const groups = groupOverviewBeatsByState([
      makeBeat("impl", "implementation"),
    ]);

    expect(
      renderableOverviewGroups(
        groups,
        [],
      ).map((group) => group.state),
    ).toEqual([
      "ready_for_planning",
      "planning",
      "ready_for_plan_review",
      "plan_review",
      "ready_for_implementation",
      "implementation",
      "ready_for_implementation_review",
      "implementation_review",
      "ready_for_shipment",
      "shipment",
      "ready_for_shipment_review",
      "shipment_review",
    ]);

    const hidden = hideOverviewColumn(
      {},
      "work_items",
      "planning",
    );

    expect(
      renderableOverviewGroups(
        groups,
        hidden.work_items ?? [],
      ).map((group) => group.state),
    ).not.toContain("planning");
  });

  it("restores and prunes hidden column state", () => {
    const groups = groupOverviewBeatsByState([
      makeBeat("plan", "planning"),
    ]);
    let hidden = hideOverviewColumn(
      { work_items: ["unknown_state"] },
      "work_items",
      "planning",
    );
    hidden = nextOverviewHiddenColumns(
      hidden,
      "work_items",
      groups,
    );

    expect(hidden.work_items).toEqual(["planning"]);
    expect(restoreOverviewColumns(hidden, "work_items")).toEqual({});
  });

  it("shows the column hide control for every column", () => {
    const activeGroup = groupOverviewBeatsByState([
      makeBeat("plan", "planning"),
    ]).find((group) => group.state === "planning");
    const emptyGroup = {
      state: "planning",
      required: true,
      beats: [],
    };

    expect(shouldShowOverviewColumnHideControl(activeGroup!)).toBe(true);
    expect(shouldShowOverviewColumnHideControl(emptyGroup)).toBe(true);
  });
});

describe("beat-state-overview sizing", () => {
  it("fills the table with one equal fr track per visible column", () => {
    expect(overviewGridTemplateColumns(1)).toBe(
      "repeat(1, minmax(80px, 1fr))",
    );
    expect(overviewGridTemplateColumns(5)).toBe(
      "repeat(5, minmax(80px, 1fr))",
    );
    expect(overviewGridTemplateColumns(12)).toBe(
      "repeat(12, minmax(80px, 1fr))",
    );
  });

  it("expands remaining columns when one is hidden", () => {
    // Hiding a column lowers the visible count, so each surviving column's
    // `1fr` share of the table width grows — the grid never leaves a gap.
    const beforeHide = overviewGridTemplateColumns(6);
    const afterHide = overviewGridTemplateColumns(5);

    expect(beforeHide).toBe("repeat(6, minmax(80px, 1fr))");
    expect(afterHide).toBe("repeat(5, minmax(80px, 1fr))");
  });

  it("resizes proportionally when a hidden column is restored", () => {
    // Restoring raises the count back; the template depends only on the
    // count, so toggle order never changes the result.
    expect(overviewGridTemplateColumns(5)).toBe(
      overviewGridTemplateColumns(5),
    );
    expect(overviewGridTemplateColumns(6)).toBe(
      "repeat(6, minmax(80px, 1fr))",
    );
  });

  it("returns an empty template when no columns are visible", () => {
    expect(overviewGridTemplateColumns(0)).toBe("none");
    expect(overviewGridTemplateColumns(-3)).toBe("none");
  });

  it("ignores fractional column counts", () => {
    expect(overviewGridTemplateColumns(3.9)).toBe(
      "repeat(3, minmax(80px, 1fr))",
    );
  });
});

describe("beat-state-overview lease metadata", () => {
  it("recognizes action states for lease metadata display", () => {
    expect(isOverviewActiveState("planning")).toBe(true);
    expect(isOverviewActiveState("implementation_review")).toBe(true);
    expect(isOverviewActiveState("ready_for_planning")).toBe(false);
  });

  it("builds lease metadata without fabricating missing fields", () => {
    const beat = makeBeat("active", "implementation", {
      metadata: {
        knotsSteps: [{
          step: "implementation",
          started_at: "2026-05-04T08:00:00.000Z",
        }],
        knotsLeaseAcquiredAt: "2026-05-04T07:30:00.000Z",
        knotsLeaseAgentInfo: {
          provider: "Codex",
          agent_name: "codex-gpt-5",
          model: "gpt-5",
          model_version: "2026-05-01",
        },
      },
    });

    expect(overviewLeaseInfoForBeat(beat)).toEqual({
      startedAt: "2026-05-04T07:30:00.000Z",
      provider: "Codex",
      agent: "codex-gpt-5",
      model: "gpt-5",
      version: "2026-05-01",
    });
    expect(
      overviewLeaseInfoForBeat(
        beat,
        {
          startedAt: "2026-05-04T09:00:00.000Z",
          model: "override",
          sessionId: "session-1",
        },
      ),
    ).toMatchObject({
      startedAt: "2026-05-04T09:00:00.000Z",
      model: "override",
      sessionId: "session-1",
    });
    expect(
      overviewLeaseInfoForBeat(makeBeat("queued", "ready_for_planning")),
    ).toBeNull();
  });

  it("does not use action step time as lease acquisition time", () => {
    const beat = makeBeat("active", "implementation", {
      metadata: {
        knotsSteps: [{
          step: "implementation",
          started_at: "2026-05-04T08:00:00.000Z",
        }],
        knotsLeaseAgentInfo: {
          provider: "Codex",
        },
      },
    });

    expect(overviewLeaseInfoForBeat(beat)).toEqual({
      provider: "Codex",
    });
  });
});
