import { describe, expect, it } from "vitest";
import {
  countGroupedBeats,
  filterOverviewBeats,
  groupBeatsByState,
  isOverviewBeat,
  normalizeOverviewState,
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

  it("places every visible beat into exactly one state group", () => {
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

  it("filters internal lease records out of the overview surface", () => {
    const work = makeBeat("work-1", "ready_for_planning");
    const lease = makeBeat("lease-1", "lease_ready", {
      type: "lease",
    });

    expect(isOverviewBeat(work)).toBe(true);
    expect(isOverviewBeat(lease)).toBe(false);
    expect(filterOverviewBeats([work, lease])).toEqual([work]);
  });
});
