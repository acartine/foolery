import { describe, expect, it } from "vitest";

import type { BeatWithRepo } from "@/lib/types";
import type { ActiveTerminal } from "@/stores/terminal-store";
import {
  buildRetakeParentIndex,
  buildRetakeShippingIndex,
  findRunningTerminalForBeat,
  repoScopedBeatKey,
} from "@/lib/retake-session-scope";
import { hasRollingAncestor } from "@/lib/rolling-ancestor";

describe("retake session: index scoping", () => {
    it("reuses only the running session from the same repo when beat ids collide", () => {
    const terminals: ActiveTerminal[] = [
      {
        sessionId: "session-a",
        beatId: "foolery-6428",
        beatTitle: "Repo A beat",
        repoPath: "/repos/a",
        status: "running",
        startedAt: "2026-03-17T09:00:00Z",
      },
      {
        sessionId: "session-b",
        beatId: "foolery-6428",
        beatTitle: "Repo B beat",
        repoPath: "/repos/b",
        status: "running",
        startedAt: "2026-03-17T09:05:00Z",
      },
    ];

    expect(findRunningTerminalForBeat(terminals, "foolery-6428", "/repos/b")?.sessionId).toBe("session-b");
    expect(findRunningTerminalForBeat(terminals, "foolery-6428", "/repos/a")?.sessionId).toBe("session-a");
  });

  it("builds shipping index entries per repo for duplicate beat ids", () => {
    const shippingByBeatId = buildRetakeShippingIndex([
      {
        sessionId: "session-a",
        beatId: "same-id",
        beatTitle: "Repo A beat",
        repoPath: "/repos/a",
        status: "running",
        startedAt: "2026-03-17T09:00:00Z",
      },
      {
        sessionId: "session-b",
        beatId: "same-id",
        beatTitle: "Repo B beat",
        repoPath: "/repos/b",
        status: "running",
        startedAt: "2026-03-17T09:05:00Z",
      },
    ]);

    expect(shippingByBeatId[repoScopedBeatKey("same-id", "/repos/a")]).toBe("session-a");
    expect(shippingByBeatId[repoScopedBeatKey("same-id", "/repos/b")]).toBe("session-b");
  });

});

describe("retake session: rolling-ancestor isolation", () => {
    it("keeps rolling-ancestor lookups inside the same repo when beat ids collide", () => {
    const beats: BeatWithRepo[] = [
      {
        id: "parent",
        title: "Repo A parent",
        type: "work",
        state: "done",
        priority: 2,
        labels: [],
        created: "2026-03-17T09:00:00Z",
        updated: "2026-03-17T09:00:00Z",
        _repoPath: "/repos/a",
        _repoName: "A",
      },
      {
        id: "child",
        title: "Repo A child",
        type: "work",
        state: "rejected",
        priority: 2,
        labels: [],
        parent: "parent",
        created: "2026-03-17T09:00:00Z",
        updated: "2026-03-17T09:00:00Z",
        _repoPath: "/repos/a",
        _repoName: "A",
      },
      {
        id: "parent",
        title: "Repo B parent",
        type: "work",
        state: "done",
        priority: 2,
        labels: [],
        created: "2026-03-17T09:00:00Z",
        updated: "2026-03-17T09:00:00Z",
        _repoPath: "/repos/b",
        _repoName: "B",
      },
      {
        id: "child",
        title: "Repo B child",
        type: "work",
        state: "rejected",
        priority: 2,
        labels: [],
        parent: "parent",
        created: "2026-03-17T09:00:00Z",
        updated: "2026-03-17T09:00:00Z",
        _repoPath: "/repos/b",
        _repoName: "B",
      },
    ];

    const parentByBeatId = buildRetakeParentIndex(beats);

    expect(
      hasRollingAncestor(
        { id: repoScopedBeatKey("child", "/repos/b"), parent: repoScopedBeatKey("parent", "/repos/b") },
        parentByBeatId,
        { [repoScopedBeatKey("parent", "/repos/a")]: "session-a" }
      )
    ).toBe(false);

    expect(
      hasRollingAncestor(
        { id: repoScopedBeatKey("child", "/repos/b"), parent: repoScopedBeatKey("parent", "/repos/b") },
        parentByBeatId,
        { [repoScopedBeatKey("parent", "/repos/b")]: "session-b" }
      )
    ).toBe(true);
  });
});
