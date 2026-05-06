import { describe, expect, it } from "vitest";
import {
  buildOverviewSetlistFilterOptions,
  buildOverviewTagFilterOptions,
  filterBeatsForOverviewFilters,
  formatOverviewSetlistFilterLabel,
  overviewVisibleBeatTags,
} from "@/lib/beat-state-overview-filters";
import type { PlanSummary } from "@/lib/orchestration-plan-types";
import type { Beat } from "@/lib/types";

function makeBeat(
  id: string,
  labels: string[],
  overrides: Partial<Beat> & { _repoPath?: string } = {},
): Beat {
  return {
    id,
    title: id,
    type: "work",
    state: "implementation",
    priority: 2,
    labels,
    created: "2026-05-01T00:00:00.000Z",
    updated: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as Beat;
}

function makePlan(
  id: string,
  beatIds: string[],
  objective?: string,
  summary = "Fallback setlist summary",
): PlanSummary {
  return {
    artifact: {
      id,
      type: "execution_plan",
      state: "planning",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    plan: {
      repoPath: "/repo/a",
      beatIds,
      objective,
      summary,
    },
  };
}

describe("beat-state-overview filters", () => {
  it("extracts user-visible beat tags and excludes overview bookkeeping", () => {
    const beat = makeBeat("a", [
      "api",
      "stage:implementation",
      "orchestration:wave:one",
      "commit:abc123",
      "branch:codex/test",
      "parent:7770",
      "api",
      "  UX  ",
    ]);

    expect(overviewVisibleBeatTags(beat)).toEqual(["api", "UX"]);
  });

  it("builds tag filter options with counts", () => {
    const options = buildOverviewTagFilterOptions([
      makeBeat("a", ["api", "ux"]),
      makeBeat("b", ["API"]),
      makeBeat("c", ["docs"]),
    ]);

    expect(options).toEqual([
      { id: "api", label: "api", count: 2 },
      { id: "docs", label: "docs", count: 1 },
      { id: "ux", label: "ux", count: 1 },
    ]);
  });

  it("labels setlist filters with id and first 40 title characters", () => {
    const objective = "1234567890123456789012345678901234567890tail";
    const plan = makePlan("foolery-plan", ["a"], objective);

    expect(formatOverviewSetlistFilterLabel(plan)).toBe(
      "foolery-plan 1234567890123456789012345678901234567890",
    );
  });

  it("filters by tags, setlists, and their intersection", () => {
    const beats = [
      makeBeat("a", ["api"], {
        aliases: ["alias-a"],
        _repoPath: "/repo/a",
      }),
      makeBeat("b", ["ux"], { _repoPath: "/repo/a" }),
      makeBeat("c", ["api"], { _repoPath: "/repo/b" }),
    ];
    const setlists = [
      ...buildOverviewSetlistFilterOptions([
        makePlan("plan-a", ["alias-a", "b"]),
      ], "/repo/a"),
      ...buildOverviewSetlistFilterOptions([
        makePlan("plan-b", ["c"]),
      ], "/repo/b"),
    ];

    expect(filterBeatsForOverviewFilters(beats, {
      selectedTagIds: new Set(["api"]),
      selectedSetlistIds: new Set(),
      setlistOptions: setlists,
    }).map((beat) => beat.id)).toEqual(["a", "c"]);

    expect(filterBeatsForOverviewFilters(beats, {
      selectedTagIds: new Set(),
      selectedSetlistIds: new Set(["/repo/a:plan-a"]),
      setlistOptions: setlists,
    }).map((beat) => beat.id)).toEqual(["a", "b"]);

    expect(filterBeatsForOverviewFilters(beats, {
      selectedTagIds: new Set(["api"]),
      selectedSetlistIds: new Set(["/repo/a:plan-a"]),
      setlistOptions: setlists,
    }).map((beat) => beat.id)).toEqual(["a"]);
  });
});
