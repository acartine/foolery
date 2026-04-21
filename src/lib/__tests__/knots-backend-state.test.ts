/**
 * KnotsBackend: update stuck state handling,
 * buildPollPrompt, and queue children inclusion.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  store,
  resetStore,
  nowIso,
  seedKnot,
  mockUpdateKnot,
  mockPollKnot,
} from "./knots-backend-mocks";

vi.mock("@/lib/knots", async () =>
  (await import("./knots-backend-mocks")).buildMockModule(),
);

import { KnotsBackend } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe("update() no-op when state matches", () => {
  it("skips status change when target state matches raw kno state", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("stuck-1", {
      id: "stuck-1",
      title: "Stuck knot",
      state: "planning",
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
      workflow_etag: "etag-stuck",
      created_at: now,
    });

    const result = await backend.update(
      "stuck-1", { state: "planning" },
    );
    expect(result.ok).toBe(true);

    const updateCalls = mockUpdateKnot.mock.calls.filter(
      (c) => c[0] === "stuck-1",
    );
    expect(updateCalls.length).toBe(0);
  });

  it("normalizes raw kno metadata state before comparing for no-op", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("stuck-1b", {
      id: "stuck-1b",
      title: "Stuck knot with formatted metadata state",
      state: "planning",
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
      workflow_etag: "etag-stuck-1b",
      created_at: now,
    });

    const listed = await backend.list();
    expect(listed.ok).toBe(true);
    const beat = listed.data?.find(
      (item) => item.id === "stuck-1b",
    );
    expect(beat).toBeTruthy();
    if (!beat) return;

    beat.metadata = {
      ...(beat.metadata ?? {}),
      knotsState: " PlAnNiNg ",
    };

    const getSpy = vi.spyOn(backend, "get").mockResolvedValue(
      { ok: true, data: beat },
    );
    try {
      const result = await backend.update(
        "stuck-1b", { state: "planning" },
      );
      expect(result.ok).toBe(true);
    } finally {
      getSpy.mockRestore();
    }

    const updateCalls = mockUpdateKnot.mock.calls.filter(
      (c) => c[0] === "stuck-1b",
    );
    expect(updateCalls.length).toBe(0);
  });
});

describe("update() passes status through without force", () => {
  it("omits force when the caller jumps across the workflow", async () => {
    // The generic update path is no longer allowed to auto-force —
    // kno is the single source of truth for workflow adjacency.
    // See knot 102e: skip-to-terminal corrections must use the
    // descriptive `markTerminal` path instead.
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("stuck-2", {
      id: "stuck-2",
      title: "Non-adjacent update",
      state: "planning",
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
      workflow_etag: "etag-stuck2",
      created_at: now,
    });

    const result = await backend.update(
      "stuck-2", { state: "ready_for_implementation" },
    );
    expect(result.ok).toBe(true);

    const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateArgs?.[1]).toMatchObject({
      status: "ready_for_implementation",
    });
    expect(lastUpdateArgs?.[1]).not.toHaveProperty("force");
  });

  it("omits force even when raw kno metadata state is missing", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("stuck-2b", {
      id: "stuck-2b",
      title: "No raw kno state",
      state: "implementation",
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
      workflow_etag: "etag-stuck2b",
      created_at: now,
    });

    const listed = await backend.list();
    expect(listed.ok).toBe(true);
    const beat = listed.data?.find(
      (item) => item.id === "stuck-2b",
    );
    expect(beat).toBeTruthy();
    if (!beat) return;

    const beatWithoutRawState = {
      ...beat,
      metadata: {
        ...(beat.metadata ?? {}),
        knotsState: undefined,
      },
    };

    const getSpy = vi.spyOn(backend, "get").mockResolvedValue(
      { ok: true, data: beatWithoutRawState },
    );
    try {
      const result = await backend.update(
        "stuck-2b", { state: "ready_for_implementation" },
      );
      expect(result.ok).toBe(true);
    } finally {
      getSpy.mockRestore();
    }

    const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateArgs?.[1]).toMatchObject({
      status: "ready_for_implementation",
    });
    expect(lastUpdateArgs?.[1]).not.toHaveProperty("force");
  });
});

describe("update() abandoned transitions", () => {
  it("keeps explicit abandoned transitions instead of remapping to initial state", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("stuck-3", {
      id: "stuck-3",
      title: "Abandon me",
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
      workflow_etag: "etag-stuck3",
      created_at: now,
    });

    const result = await backend.update(
      "stuck-3", { state: "abandoned" },
    );
    expect(result.ok).toBe(true);

    const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateArgs?.[1]).toMatchObject({
      status: "abandoned",
    });
  });
});

describe("update() shipped transitions", () => {
  it("accepts shipping from a non-terminal active state", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("ship-1", {
      id: "ship-1",
      title: "Ship me from implementation",
      state: "implementation",
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
      workflow_etag: "etag-ship1",
      created_at: now,
    });

    const result = await backend.update(
      "ship-1", { state: "shipped" },
    );
    expect(result.ok).toBe(true);

    const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateArgs?.[1]).toMatchObject({
      status: "shipped",
    });
  });

  it("accepts shipping from a queued state", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("ship-2", {
      id: "ship-2",
      title: "Ship me from queue",
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
      workflow_etag: "etag-ship2",
      created_at: now,
    });

    const result = await backend.update(
      "ship-2", { state: "shipped" },
    );
    expect(result.ok).toBe(true);

    const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateArgs?.[1]).toMatchObject({
      status: "shipped",
    });
  });

  it("is a no-op when the knot is already shipped", async () => {
    const backend = new KnotsBackend("/repo");
    const now = nowIso();
    store.knots.set("ship-3", {
      id: "ship-3",
      title: "Already shipped knot",
      state: "shipped",
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
      workflow_etag: "etag-ship3",
      created_at: now,
    });

    const result = await backend.update(
      "ship-3", { state: "shipped" },
    );
    expect(result.ok).toBe(true);

    const updateCalls = mockUpdateKnot.mock.calls.filter(
      (c) => c[0] === "ship-3",
    );
    expect(updateCalls.length).toBe(0);
  });
});

describe("buildPollPrompt", () => {
  it("polls for the highest-priority claimable knot", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Poll target",
      type: "task",
      priority: 0,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.buildPollPrompt({
      agentName: "test-agent",
      agentModel: "test-model",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.claimedId).toBe(created.data!.id);
    expect(result.data?.prompt).toContain("Poll target");
    expect(mockPollKnot).toHaveBeenCalledWith("/repo", {
      agentName: "test-agent",
      agentModel: "test-model",
      agentVersion: undefined,
    });
  });

  it("returns error when no claimable work exists", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.buildPollPrompt({
      agentName: "test-agent",
    });
    expect(result.ok).toBe(false);
  });
});

describe("queue children: queued parent descendants", () => {
  it("includes shipped/abandoned children when parent is in a queue state (queued filter)", async () => {
    seedKnot("parent-1", "ready_for_implementation", {
      type: "epic",
    });
    seedKnot("child-shipped", "shipped");
    seedKnot("child-abandoned", "abandoned");
    seedKnot("child-active", "implementation");
    seedKnot("child-queued", "ready_for_planning");
    seedKnot("unrelated", "shipped");

    store.edges.push({
      src: "parent-1",
      kind: "parent_of",
      dst: "child-shipped",
    });
    store.edges.push({
      src: "parent-1",
      kind: "parent_of",
      dst: "child-abandoned",
    });
    store.edges.push({
      src: "parent-1",
      kind: "parent_of",
      dst: "child-active",
    });
    store.edges.push({
      src: "parent-1",
      kind: "parent_of",
      dst: "child-queued",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id).sort();
    expect(ids).toContain("parent-1");
    expect(ids).toContain("child-queued");
    expect(ids).toContain("child-shipped");
    expect(ids).toContain("child-abandoned");
    expect(ids).toContain("child-active");
    expect(ids).not.toContain("unrelated");
  });

  it("includes deeply nested descendants of queue parents", async () => {
    seedKnot("root", "ready_for_planning", { type: "epic" });
    seedKnot("mid", "implementation");
    seedKnot("leaf", "shipped");

    store.edges.push({
      src: "root", kind: "parent_of", dst: "mid",
    });
    store.edges.push({
      src: "mid", kind: "parent_of", dst: "leaf",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id).sort();
    expect(ids).toContain("root");
    expect(ids).toContain("mid");
    expect(ids).toContain("leaf");
  });

});

describe("queue children: specific state filter and ancestor chains", () => {
  it("includes each active beat's queued ancestors without surfacing terminal siblings", async () => {
    seedKnot("grandparent-q", "ready_for_planning", {
      type: "initiative",
    });
    seedKnot("parent-q", "ready_for_implementation", {
      type: "epic",
    });
    seedKnot("child-impl", "implementation");
    seedKnot("child-done", "shipped");

    store.edges.push({
      src: "grandparent-q",
      kind: "parent_of",
      dst: "parent-q",
    });
    store.edges.push({
      src: "parent-q",
      kind: "parent_of",
      dst: "child-impl",
    });
    store.edges.push({
      src: "parent-q",
      kind: "parent_of",
      dst: "child-done",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ state: "in_action" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id).sort();
    expect(ids).toContain("child-impl");
    expect(ids).toContain("parent-q");
    expect(ids).toContain("grandparent-q");
    expect(ids).not.toContain("child-done");
  });

  it("does not include children when using a specific state filter", async () => {
    seedKnot("parent-q", "ready_for_implementation", {
      type: "epic",
    });
    seedKnot("child-done", "shipped");

    store.edges.push({
      src: "parent-q",
      kind: "parent_of",
      dst: "child-done",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.list({
      state: "ready_for_implementation",
    });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id);
    expect(ids).toContain("parent-q");
    expect(ids).not.toContain("child-done");
  });

  it("includes ancestor chain when a queued child's parent is not in a queued state", async () => {
    seedKnot("active-parent", "implementation", {
      type: "epic",
    });
    seedKnot("queued-child", "ready_for_planning");

    store.edges.push({
      src: "active-parent",
      kind: "parent_of",
      dst: "queued-child",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id);
    expect(ids).toContain("queued-child");
    expect(ids).toContain("active-parent");
  });

  it("includes full ancestor chain for deeply nested queued descendants", async () => {
    seedKnot("shipped-gp", "shipped", {
      type: "initiative",
    });
    seedKnot("active-parent", "implementation", {
      type: "epic",
    });
    seedKnot("queued-child", "ready_for_planning");

    store.edges.push({
      src: "shipped-gp",
      kind: "parent_of",
      dst: "active-parent",
    });
    store.edges.push({
      src: "active-parent",
      kind: "parent_of",
      dst: "queued-child",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);

    const ids = result.data!.map((b) => b.id);
    expect(ids).toContain("queued-child");
    expect(ids).toContain("active-parent");
    expect(ids).toContain("shipped-gp");
  });
});
