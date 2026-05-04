import { describe, expect, it } from "vitest";
import {
  buildStaleBeatReviewRequest,
  getStaleBeatSummaries,
  isStaleBeat,
  staleBeatAgeDays,
  selectOldestStaleBeatSummaries,
  staleBeatTargetKey,
} from "@/lib/stale-beat-grooming";
import type { Beat } from "@/lib/types";

const NOW_MS = Date.parse("2026-05-10T00:00:00.000Z");

function makeBeat(
  id: string,
  created: string,
  overrides: Partial<Beat> = {},
): Beat {
  return {
    id,
    title: id,
    type: "work",
    state: "ready_for_planning",
    priority: 2,
    labels: [],
    created,
    updated: created,
    ...overrides,
  };
}

describe("stale beat grooming age rules", () => {
  it("treats beats as stale only when updated more than 7 days ago", () => {
    expect(
      isStaleBeat(
        makeBeat("old", "2026-05-02T23:59:59.999Z"),
        NOW_MS,
      ),
    ).toBe(true);
    expect(
      isStaleBeat(
        makeBeat("fresh", "2026-04-01T00:00:00.000Z", {
          updated: "2026-05-09T00:00:00.000Z",
        }),
        NOW_MS,
      ),
    ).toBe(false);
  });

  it("ignores invalid dates, leases, and terminated overview beats", () => {
    expect(isStaleBeat(makeBeat("bad", "nope"), NOW_MS)).toBe(false);
    expect(
      isStaleBeat(
        makeBeat("lease", "2026-05-01T00:00:00.000Z", {
          type: "lease",
        }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      isStaleBeat(
        makeBeat("done", "2026-05-01T00:00:00.000Z", {
          state: "shipped",
        }),
        NOW_MS,
      ),
    ).toBe(false);
  });

  it("reports whole age days with an injected clock", () => {
    expect(
      staleBeatAgeDays(
        makeBeat("old", "2026-05-01T12:00:00.000Z"),
        NOW_MS,
      ),
    ).toBe(8);
    expect(staleBeatAgeDays(makeBeat("bad", "nope"), NOW_MS)).toBeNull();
  });
});

describe("stale beat grooming summaries and payloads", () => {
  it("orders stale beats by last-updated age descending", () => {
    const freshest = makeBeat("freshest", "2026-04-01T00:00:00.000Z", {
      updated: "2026-05-01T00:00:00.000Z",
    });
    const oldest = makeBeat("oldest", "2026-04-01T00:00:00.000Z", {
      updated: "2026-04-20T00:00:00.000Z",
    });
    const middle = makeBeat("middle", "2026-04-01T00:00:00.000Z", {
      updated: "2026-04-25T00:00:00.000Z",
    });

    expect(
      getStaleBeatSummaries([freshest, oldest, middle], NOW_MS)
        .map((summary) => summary.beatId),
    ).toEqual(["oldest", "middle", "freshest"]);
  });

  it("selects the oldest stale subset for small grooming batches", () => {
    const summaries = getStaleBeatSummaries(
      [
        makeBeat("a", "2026-04-01T00:00:00.000Z", {
          updated: "2026-04-01T00:00:00.000Z",
        }),
        makeBeat("b", "2026-04-01T00:00:00.000Z", {
          updated: "2026-04-02T00:00:00.000Z",
        }),
        makeBeat("c", "2026-04-01T00:00:00.000Z", {
          updated: "2026-04-03T00:00:00.000Z",
        }),
      ],
      NOW_MS,
    );

    expect(
      selectOldestStaleBeatSummaries(summaries, 2)
        .map((summary) => summary.beatId),
    ).toEqual(["a", "b"]);
  });

  it("builds stable repo-qualified keys for all-repo overview beats", () => {
    const beat = makeBeat("foolery-1", "2026-05-01T00:00:00.000Z", {
      _repoPath: "/tmp/repo",
      _repoName: "repo",
    } as Partial<Beat>);

    const summaries = getStaleBeatSummaries([beat], NOW_MS);

    expect(summaries).toMatchObject([
      {
        key: "/tmp/repo::foolery-1",
        beatId: "foolery-1",
        repoPath: "/tmp/repo",
        repoName: "repo",
        ageDays: 9,
        createdAgeDays: 9,
      },
    ]);
  });

  it("shapes review requests from selected stale summaries", () => {
    const selected = makeBeat(
      "selected",
      "2026-05-01T00:00:00.000Z",
      { _repoPath: "/tmp/repo" } as Partial<Beat>,
    );
    const skipped = makeBeat(
      "skipped",
      "2026-05-01T00:00:00.000Z",
    );
    const summaries = getStaleBeatSummaries(
      [selected, skipped],
      NOW_MS,
    );
    const selectedKeys = new Set([
      staleBeatTargetKey({
        beatId: "selected",
        repoPath: "/tmp/repo",
      }),
    ]);

    expect(
      buildStaleBeatReviewRequest({
        summaries,
        selectedKeys,
        agentId: " codex ",
      }),
    ).toEqual({
      agentId: "codex",
      targets: [
        {
          beatId: "selected",
          repoPath: "/tmp/repo",
        },
      ],
    });
  });
});
