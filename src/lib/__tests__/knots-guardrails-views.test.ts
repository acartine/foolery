/**
 * Knots guardrails: table/filter/sort/hierarchy views.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHierarchy } from "@/lib/beat-hierarchy";
import { compareBeatsByPriorityThenState } from "@/lib/beat-sort";

import {
  type MockKnot,
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

// ── g3y1.5.3: Table/filter/sort/hierarchy ───────────────────

function seedViewKnots() {
  const now = nowIso();
  const knots: MockKnot[] = [
    {
      id: "g3y1",
      title: "Epic parent",
      state: "implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: "Parent epic",
      priority: 0,
      type: "epic",
      tags: ["source:test"],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-1",
      created_at: now,
    },
    {
      id: "g3y1.1",
      title: "Child task 1",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: "First child",
      priority: 1,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-2",
      created_at: now,
    },
    {
      id: "g3y1.2",
      title: "Child task 2",
      state: "shipped",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: "Second child (done)",
      priority: 2,
      type: "task",
      tags: ["bug"],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-3",
      created_at: now,
    },
    {
      id: "g3y1.1.1",
      title: "Grandchild",
      state: "ready_for_planning",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: "Grandchild task",
      priority: 3,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-4",
      created_at: now,
    },
  ];
  for (const knot of knots) {
    store.knots.set(knot.id, knot);
  }
}

describe("filter by state: queued and lease filtering", () => {
  it("filters by 'queued' (ready_for_* states)", async () => {
      seedViewKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "queued" });
      expect(result.ok).toBe(true);
      const ids = result.data!.map((b) => b.id);
      expect(ids).toContain("g3y1.1");
      expect(ids).toContain("g3y1.1.1");
      expect(ids).toContain("g3y1");
      expect(ids).not.toContain("g3y1.2");
    });

    it("hides lease knots from the queued view", async () => {
      seedViewKnots();
      store.knots.set("lease-1", {
        id: "lease-1",
        title: "Runtime lease",
        state: "ready_for_planning",
        profile_id: "autopilot",
        workflow_id: "autopilot",
        updated_at: nowIso(),
        body: null,
        description: "Lease row",
        priority: 2,
        type: "lease",
        tags: [],
        notes: [],
        handoff_capsules: [],
        workflow_etag: "etag-lease-1",
        created_at: nowIso(),
      });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "queued" });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((beat) => beat.id);
      expect(ids).not.toContain("lease-1");
    });

    it("hides lease knots from exact queue-state filters", async () => {
      seedViewKnots();
      store.knots.set("lease-2", {
        id: "lease-2",
        title: "Exact-state lease",
        state: "ready_for_planning",
        profile_id: "autopilot",
        workflow_id: "autopilot",
        updated_at: nowIso(),
        body: null,
        description: "Lease row",
        priority: 2,
        type: "lease",
        tags: [],
        notes: [],
        handoff_capsules: [],
        workflow_etag: "etag-lease-2",
        created_at: nowIso(),
      });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({
        state: "ready_for_planning",
      });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((beat) => beat.id);
      expect(ids).not.toContain("lease-2");
    });
});

describe("filter by state: queued descendants", () => {
  it("keeps all descendants of queued parents in the queues view", async () => {
      seedViewKnots();
      store.knots.set("g3y1.3", {
        id: "g3y1.3",
        title: "Queued child with terminal descendants",
        state: "ready_for_implementation",
        profile_id: "autopilot",
        workflow_id: "autopilot",
        updated_at: nowIso(),
        body: null,
        description: "Queued child",
        priority: 2,
        type: "task",
        tags: [],
        notes: [],
        handoff_capsules: [],
        workflow_etag: "etag-5",
        created_at: nowIso(),
      });
      store.knots.set("g3y1.3.1", {
        id: "g3y1.3.1",
        title: "Shipped grandchild",
        state: "shipped",
        profile_id: "autopilot",
        workflow_id: "autopilot",
        updated_at: nowIso(),
        body: null,
        description: "Terminal descendant",
        priority: 2,
        type: "task",
        tags: [],
        notes: [],
        handoff_capsules: [],
        workflow_etag: "etag-6",
        created_at: nowIso(),
      });
      store.knots.set("g3y1.3.2", {
        id: "g3y1.3.2",
        title: "Abandoned grandchild",
        state: "abandoned",
        profile_id: "autopilot",
        workflow_id: "autopilot",
        updated_at: nowIso(),
        body: null,
        description: "Another terminal descendant",
        priority: 2,
        type: "task",
        tags: [],
        notes: [],
        handoff_capsules: [],
        workflow_etag: "etag-7",
        created_at: nowIso(),
      });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "queued" });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((beat) => beat.id);
      expect(ids).toContain("g3y1.3");
      expect(ids).toContain("g3y1.3.1");
      expect(ids).toContain("g3y1.3.2");
    });
});

describe("filter by state: in_action and exact", () => {
  it("filters by 'in_action' (action states)", async () => {
      seedViewKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({
        state: "in_action",
      });
      expect(result.ok).toBe(true);
      const ids = result.data!.map((b) => b.id);
      expect(ids).toContain("g3y1");
      expect(ids).not.toContain("g3y1.1");
    });

    it("filters by exact state name", async () => {
      seedViewKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "shipped" });
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1.2");
    });
});

describe("filter by type", () => {
  it("filters by type='epic'", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ type: "epic" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0].id).toBe("g3y1");
  });

  it("filters by type='task'", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ type: "task" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(3);
  });
});

describe("filter by priority and label", () => {
  it("filters by priority=0", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ priority: 0 });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0].id).toBe("g3y1");
  });

  it("filters by label", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ label: "bug" });
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0].id).toBe("g3y1.2");
  });
});

describe("hierarchy", () => {
  it("infers parent from hierarchical dotted IDs", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list();
    expect(result.ok).toBe(true);

    const beats = result.data!;
    const child1 = beats.find((b) => b.id === "g3y1.1");
    const child2 = beats.find((b) => b.id === "g3y1.2");
    const grandchild = beats.find(
      (b) => b.id === "g3y1.1.1",
    );

    expect(child1?.parent).toBe("g3y1");
    expect(child2?.parent).toBe("g3y1");
    expect(grandchild?.parent).toBe("g3y1.1");
  });

  it("builds hierarchical tree from flat beats", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list();
    expect(result.ok).toBe(true);

    const hierarchical = buildHierarchy(result.data!);
    expect(hierarchical.length).toBeGreaterThan(0);

    const root = hierarchical.find(
      (h) => h.id === "g3y1",
    );
    expect(root).toBeDefined();
    expect(root!._depth).toBe(0);
    expect(root!._hasChildren).toBe(true);
  });
});

describe("sort and search", () => {
  it("sorts by priority then state", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.list();
    expect(result.ok).toBe(true);

    const sorted = [...result.data!].sort(
      compareBeatsByPriorityThenState,
    );
    expect(sorted[0].priority).toBe(0);
    expect(sorted[sorted.length - 1].priority).toBe(3);
  });

  it("searches across title and description", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.search("Grandchild");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0].id).toBe("g3y1.1.1");
  });

  it("searches by partial ID match", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.search("g3y1.1");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(2);
  });
});

describe("query expressions", () => {
  it("query by type:task", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.query("type:task");
    expect(result.ok).toBe(true);
    for (const beat of result.data!) {
      expect(beat.type).toBe("task");
    }
  });

  it("query by state:shipped", async () => {
    seedViewKnots();
    const backend = new KnotsBackend("/repo");
    const result = await backend.query("state:shipped");
    expect(result.ok).toBe(true);
    expect(result.data!.length).toBe(1);
    expect(result.data![0].id).toBe("g3y1.2");
  });
});
