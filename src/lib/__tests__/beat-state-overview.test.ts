import { describe, expect, it } from "vitest";
import {
  countGroupedBeats,
  filterOverviewBeats,
  groupBeatsByState,
  groupOverviewBeatsByState,
  isOverviewActiveState,
  isOverviewBeat,
  normalizeOverviewState,
  overviewBeatLabel,
  overviewLeaseInfoForBeat,
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
    expect(isOverviewBeat(shipped)).toBe(false);
    expect(filterOverviewBeats([work, lease, shipped])).toEqual([work]);
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
        knotsLeaseAgentInfo: {
          provider: "Codex",
          model: "gpt-5",
          model_version: "2026-05-01",
        },
      },
    });

    expect(overviewLeaseInfoForBeat(beat)).toEqual({
      startedAt: "2026-05-04T08:00:00.000Z",
      provider: "Codex",
      model: "gpt-5",
      version: "2026-05-01",
    });
    expect(
      overviewLeaseInfoForBeat(
        beat,
        { startedAt: "2026-05-04T09:00:00.000Z", model: "override" },
      ),
    ).toMatchObject({
      startedAt: "2026-05-04T09:00:00.000Z",
      model: "override",
    });
    expect(
      overviewLeaseInfoForBeat(makeBeat("queued", "ready_for_planning")),
    ).toBeNull();
  });
});
