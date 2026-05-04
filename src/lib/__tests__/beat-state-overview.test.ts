import { describe, expect, it } from "vitest";
import {
  buildOverviewStateTabs,
  countGroupedBeats,
  filterOverviewBeats,
  groupBeatsByState,
  groupOverviewBeatsByState,
  hideOverviewIntroducedColumn,
  isOverviewActiveState,
  isOverviewBeat,
  nextOverviewIntroducedColumns,
  nextOverviewSizingColumnCount,
  nextOverviewSizingColumnCounts,
  normalizeOverviewState,
  overviewBeatLabel,
  overviewColumnWidthPx,
  overviewLeaseInfoForBeat,
  overviewTabForBeat,
  overviewTabForState,
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

    const terminated = groupOverviewBeatsByState(beats, "terminated");
    expect(terminated.map((group) => group.state)).toEqual([
      "abandoned",
      "deferred",
      "shipped",
    ]);
    expect(
      terminated.find((group) => group.state === "shipped")?.beats[0]?.id,
    ).toBe("ship");
  });

  it("keeps required special-tab columns when those tabs are empty", () => {
    expect(groupOverviewBeatsByState([], "exploration")).toMatchObject([
      { state: "ready_for_exploration", required: true, beats: [] },
    ]);
    expect(groupOverviewBeatsByState([], "gates")).toMatchObject([
      { state: "ready_to_evaluate", required: true, beats: [] },
    ]);
    expect(groupOverviewBeatsByState([], "terminated")).toMatchObject([
      { state: "abandoned", required: true, beats: [] },
      { state: "deferred", required: true, beats: [] },
      { state: "shipped", required: true, beats: [] },
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

describe("beat-state-overview introduced columns", () => {
  it("keeps introduced empty columns visible until hidden", () => {
    let introduced = nextOverviewIntroducedColumns(
      {},
      "work_items",
      groupOverviewBeatsByState([
        makeBeat("plan", "planning"),
        makeBeat("impl", "implementation"),
      ]),
    );

    const emptiedGroups = groupOverviewBeatsByState([
      makeBeat("impl", "implementation"),
    ]);

    expect(
      renderableOverviewGroups(
        "work_items",
        emptiedGroups,
        introduced.work_items ?? [],
      ).map((group) => group.state),
    ).toEqual(["planning", "implementation"]);

    introduced = hideOverviewIntroducedColumn(
      introduced,
      "work_items",
      "planning",
    );

    expect(
      renderableOverviewGroups(
        "work_items",
        emptiedGroups,
        introduced.work_items ?? [],
      ).map((group) => group.state),
    ).toEqual(["implementation"]);
  });

  it("reintroduces hidden columns when beats return", () => {
    let introduced = nextOverviewIntroducedColumns(
      {},
      "work_items",
      groupOverviewBeatsByState([
        makeBeat("plan", "planning"),
      ]),
    );

    introduced = hideOverviewIntroducedColumn(
      introduced,
      "work_items",
      "planning",
    );
    introduced = nextOverviewIntroducedColumns(
      introduced,
      "work_items",
      groupOverviewBeatsByState([
        makeBeat("plan", "planning"),
      ]),
    );

    expect(introduced.work_items).toEqual(["planning"]);
  });

  it("shows the empty-column hide control only at zero count", () => {
    const activeGroup = groupOverviewBeatsByState([
      makeBeat("plan", "planning"),
    ]).find((group) => group.state === "planning");
    const emptyGroup = {
      state: "planning",
      required: true,
      beats: [],
    };

    expect(shouldShowOverviewColumnHideControl(activeGroup!)).toBe(false);
    expect(shouldShowOverviewColumnHideControl(emptyGroup)).toBe(true);
  });
});

describe("beat-state-overview sizing", () => {
  it("caps overview columns at one sixth of available width", () => {
    expect(overviewColumnWidthPx(1200, 3)).toBe(200);
    expect(overviewColumnWidthPx(300, 1)).toBe(50);
    expect(overviewColumnWidthPx(2000, 2)).toBe(320);
  });

  it("sizes visible columns from available width and sizing count", () => {
    expect(overviewColumnWidthPx(1200, 10)).toBe(109);
    expect(overviewColumnWidthPx(240, 10)).toBe(40);
    expect(overviewColumnWidthPx(0, 2)).toBe(160);
    expect(overviewColumnWidthPx(1200, 0)).toBe(160);
  });

  it("promotes sizing pressure by two columns on growth", () => {
    let watermark = nextOverviewSizingColumnCount(undefined, 4);

    expect(watermark).toBe(4);
    expect(overviewColumnWidthPx(1200, watermark)).toBe(200);

    watermark = nextOverviewSizingColumnCount(watermark, 6);

    expect(watermark).toBe(8);
    expect(overviewColumnWidthPx(1200, watermark)).toBe(133);
  });

  it("keeps the sizing watermark when visible columns decrease", () => {
    const watermark = nextOverviewSizingColumnCount(8, 4);

    expect(watermark).toBe(8);
    expect(overviewColumnWidthPx(1200, watermark)).toBe(133);
  });

  it("tracks sizing watermarks independently by tab", () => {
    let watermarks = nextOverviewSizingColumnCounts(
      {},
      "work_items",
      4,
    );
    watermarks = nextOverviewSizingColumnCounts(
      watermarks,
      "terminated",
      2,
    );
    watermarks = nextOverviewSizingColumnCounts(
      watermarks,
      "work_items",
      6,
    );
    watermarks = nextOverviewSizingColumnCounts(
      watermarks,
      "terminated",
      1,
    );

    expect(watermarks).toMatchObject({
      work_items: 8,
      terminated: 2,
    });
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
