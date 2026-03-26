/**
 * Knots guardrails: mixed All Repositories behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOTS_METADATA_KEYS } from "@/lib/knots-compat";
import { buildHierarchy } from "@/lib/beat-hierarchy";
import { compareBeatsByPriorityThenState } from "@/lib/beat-sort";
import type { Beat, BeatWithRepo } from "@/lib/types";

import {
  store,
  resetStore,
  nowIso,
} from "./knots-guardrails-mocks";

vi.mock("@/lib/knots", async () =>
  (await import("./knots-guardrails-mocks")).buildMockModule(),
);

import { KnotsBackend } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── g3y1.5.4: Mixed All Repositories behavior ──────────────

describe("Mixed: multi-repo annotation and concatenation", () => {
  it("Knots beats include _repoPath when annotated for multi-repo view", async () => {
    const now = nowIso();
    store.knots.set("K-multi", {
      id: "K-multi",
      title: "Multi-repo beat",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 1,
      type: "work",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-m",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo-a");
    const result = await backend.list();
    expect(result.ok).toBe(true);

    const beatsWithRepo: BeatWithRepo[] = result.data!.map(
      (beat) => ({
        ...beat,
        _repoPath: "/repo-a",
        _repoName: "repo-a",
      }),
    );

    expect(beatsWithRepo[0]._repoPath).toBe("/repo-a");
    expect(beatsWithRepo[0]._repoName).toBe("repo-a");
    expect(beatsWithRepo[0].id).toBe("K-multi");
  });

  it("beats from different backends can be concatenated", async () => {
    const knotsBeat: BeatWithRepo = {
      id: "knot-1",
      title: "Knots beat",
      type: "work",
      state: "ready_for_implementation",
      priority: 1,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
      metadata: {
        [KNOTS_METADATA_KEYS.state]:
          "ready_for_implementation",
      },
      _repoPath: "/knots-repo",
      _repoName: "knots-repo",
    };

    const beatsBeat: BeatWithRepo = {
      id: "beat-1",
      title: "Beats beat",
      type: "task",
      state: "open",
      priority: 2,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
      _repoPath: "/beats-repo",
      _repoName: "beats-repo",
    };

    const allBeats = [knotsBeat, beatsBeat];
    expect(allBeats).toHaveLength(2);
    expect(allBeats[0]._repoName).toBe("knots-repo");
    expect(allBeats[1]._repoName).toBe("beats-repo");

    expect(allBeats[0].state).toBeDefined();
    expect(allBeats[1].state).toBeDefined();
  });
});

describe("Mixed: cross-backend sort and hierarchy", () => {
  it("sort works across mixed backend beats", () => {
    const knotsBeat: Beat = {
      id: "knot-1",
      title: "Knots P0",
      type: "work",
      state: "ready_for_implementation",
      priority: 0,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
    };

    const beatsBeat: Beat = {
      id: "beat-1",
      title: "Beats P2",
      type: "task",
      state: "open",
      priority: 2,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
    };

    const sorted = [beatsBeat, knotsBeat].sort(
      compareBeatsByPriorityThenState,
    );
    expect(sorted[0].id).toBe("knot-1");
    expect(sorted[1].id).toBe("beat-1");
  });

  it("hierarchy works for knots beats with dotted IDs in mixed view", () => {
    const beats: Beat[] = [
      {
        id: "g3y1",
        title: "Parent",
        type: "epic",
        state: "implementation",
        priority: 0,
        labels: [],
        created: nowIso(),
        updated: nowIso(),
      },
      {
        id: "g3y1.1",
        title: "Child",
        type: "task",
        state: "ready_for_implementation",
        priority: 1,
        labels: [],
        parent: "g3y1",
        created: nowIso(),
        updated: nowIso(),
      },
      {
        id: "beats-123",
        title: "Beats task",
        type: "task",
        state: "open",
        priority: 2,
        labels: [],
        created: nowIso(),
        updated: nowIso(),
      },
    ];

    const hierarchical = buildHierarchy(beats);
    const roots = hierarchical.filter(
      (h) => h._depth === 0,
    );
    expect(roots.length).toBe(2);

    const parent = hierarchical.find(
      (h) => h.id === "g3y1",
    );
    expect(parent!._hasChildren).toBe(true);

    const beatItem = hierarchical.find(
      (h) => h.id === "beats-123",
    );
    expect(beatItem!._hasChildren).toBe(false);
    expect(beatItem!._depth).toBe(0);
  });
});
