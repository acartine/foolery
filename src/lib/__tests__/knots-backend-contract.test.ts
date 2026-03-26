/**
 * KnotsBackend contract tests, mapping behaviour,
 * parent inference, and buildTakePrompt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBackendContractTests } from "./backend-contract.test";

import {
  store,
  resetStore,
  nowIso,
  mockShowKnot,
  mockUpdateKnot,
  mockListEdges,
  mockAddEdge,
  mockClaimKnot,
} from "./knots-backend-mocks";

vi.mock("@/lib/knots", async () =>
  (await import("./knots-backend-mocks")).buildMockModule(),
);

import {
  KnotsBackend,
  KNOTS_CAPABILITIES,
} from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

runBackendContractTests(
  "KnotsBackend (mocked knots CLI)",
  () => {
    const backend = new KnotsBackend("/repo");
    return {
      port: backend,
      capabilities: KNOTS_CAPABILITIES,
      cleanup: async () => {
        resetStore();
      },
    };
  },
);

describe("KnotsBackend: close and state mapping", () => {
  it("maps close() to shipped state with force", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Close mapping",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    await backend.close(created.data!.id, "done");

    const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateArgs?.[1]).toMatchObject({
      status: "shipped", force: true,
    });

    const fetched = await backend.get(created.data!.id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data?.state).toBe("shipped");
    expect(
      (fetched.data?.metadata as Record<string, unknown>)
        ?.knotsState,
    ).toBe("shipped");
  });

  it("preserves abandoned state when profile metadata omits it", async () => {
    const now = nowIso();
    store.knots.set("abandon-1", {
      id: "abandon-1",
      title: "Abandoned knot",
      state: "abandoned",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-abandon-1",
      created_at: now,
    });

    const listed = await new KnotsBackend("/repo").list();
    expect(listed.ok).toBe(true);
    const beat = listed.data?.find(
      (item) => item.id === "abandon-1",
    );
    expect(beat?.state).toBe("abandoned");
    expect(beat?.metadata?.knotsState).toBe("abandoned");
  });
});

describe("KnotsBackend: dependency and parent edge mapping", () => {
  it("maps addDependency blocker->blocked to blocked_by edge with reversed src/dst", async () => {
    const backend = new KnotsBackend("/repo");
    const blocker = await backend.create({
      title: "Blocker",
      type: "task",
      priority: 2,
      labels: [],
    });
    const blocked = await backend.create({
      title: "Blocked",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(blocker.ok).toBe(true);
    expect(blocked.ok).toBe(true);

    const result = await backend.addDependency(
      blocker.data!.id, blocked.data!.id,
    );
    expect(result.ok).toBe(true);
    expect(mockAddEdge).toHaveBeenCalledWith(
      blocked.data!.id, "blocked_by", blocker.data!.id, "/repo",
    );
  });

  it("surfaces parent via parent_of edge mapping", async () => {
    const backend = new KnotsBackend("/repo");
    const parent = await backend.create({
      title: "Parent",
      type: "task",
      priority: 2,
      labels: [],
    });
    const child = await backend.create({
      title: "Child",
      type: "task",
      priority: 2,
      labels: [],
      parent: parent.data!.id,
    });
    expect(parent.ok).toBe(true);
    expect(child.ok).toBe(true);

    const fetched = await backend.get(child.data!.id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data?.parent).toBe(parent.data!.id);
  });
});

describe("KnotsBackend: hierarchical parent inference", () => {
  it("infers parent from hierarchical dotted id when parent_of edge is missing", async () => {
    const now = nowIso();
    store.knots.set("foolery-g3y1", {
      id: "foolery-g3y1",
      title: "Parent",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "epic",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-parent",
      created_at: now,
    });
    store.knots.set("foolery-g3y1.6.4", {
      id: "foolery-g3y1.6.4",
      title: "Leaf",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-leaf",
      created_at: now,
    });
    store.knots.set("foolery-g3y1.6", {
      id: "foolery-g3y1.6",
      title: "Intermediate",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-mid",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo");
    const listed = await backend.list();
    expect(listed.ok).toBe(true);

    const leaf = listed.data?.find(
      (knot) => knot.id === "foolery-g3y1.6.4",
    );
    const intermediate = listed.data?.find(
      (knot) => knot.id === "foolery-g3y1.6",
    );
    expect(leaf?.parent).toBe("foolery-g3y1.6");
    expect(intermediate?.parent).toBe("foolery-g3y1");
  });
});

describe("KnotsBackend: hierarchical alias inference", () => {
  it("infers parent from hierarchical dotted alias when id has no dots", async () => {
    const now = nowIso();
    store.knots.set("8792", {
      id: "8792",
      title: "Parent epic",
      state: "ready_for_plan_review",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "epic",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-parent",
      created_at: now,
    });
    store.knots.set("c5cd", {
      id: "c5cd",
      alias: "brutus-8792.5",
      title: "Child task",
      state: "ready_for_planning",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-child",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo");
    const listed = await backend.list();
    expect(listed.ok).toBe(true);

    const child = listed.data?.find(
      (knot) => knot.id === "c5cd",
    );
    expect(child?.parent).toBe("8792");
    expect(child?.aliases).toEqual(["brutus-8792.5"]);
  });
});

describe("KnotsBackend: edge resilience and unsupported ops", () => {
  it("keeps list resilient when per-knot edge lookup fails", async () => {
    const now = nowIso();
    store.knots.set("foolery-g3y1", {
      id: "foolery-g3y1",
      title: "Parent",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "epic",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-parent",
      created_at: now,
    });
    store.knots.set("foolery-g3y1.1", {
      id: "foolery-g3y1.1",
      title: "Child",
      state: "ready_for_implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "task",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "etag-child",
      created_at: now,
    });

    mockListEdges.mockImplementationOnce(
      async () =>
        ({
          ok: false as const,
          error: "knots command timed out after 20000ms",
        }) as never,
    );

    const backend = new KnotsBackend("/repo");
    const listed = await backend.list();
    expect(listed.ok).toBe(true);

    const child = listed.data?.find(
      (knot) => knot.id === "foolery-g3y1.1",
    );
    expect(child?.parent).toBe("foolery-g3y1");
  });

  it("returns UNSUPPORTED for delete", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED");
  });
});

describe("KnotsBackend: buildTakePrompt", () => {
  it("shows a knot and returns claim instructions (not pre-claimed)", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Claim me",
      type: "task",
      priority: 1,
      labels: [],
    });
    expect(created.ok).toBe(true);
    const id = created.data!.id;

    const result = await backend.buildTakePrompt(id);
    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain(id);
    expect(result.data?.prompt).toContain(
      "KNOTS CLAIM MODE",
    );
    expect(result.data?.prompt).toContain("kno claim");
    expect(result.data?.prompt).toContain(
      "single-step authorization",
    );
    expect(result.data?.prompt).toContain(
      "Do not inspect, review, or advance later"
      + " workflow states on your own.",
    );
    expect(result.data?.claimed).toBe(false);
    expect(mockShowKnot).toHaveBeenCalledWith(
      id, "/repo",
    );
    expect(mockClaimKnot).not.toHaveBeenCalled();
  });
});
