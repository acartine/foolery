/**
 * Tests for API/UI compatibility guardrails when using Knots-backed repos.
 *
 * Covers:
 * - g3y1.5.1: Raw Knots state preserved in metadata
 * - g3y1.5.2: Capability-aware API guard behavior (UNSUPPORTED error codes)
 * - g3y1.5.3: Table/filter/sort/hierarchy views on Knots repos
 * - g3y1.5.4: Mixed All Repositories behavior
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOTS_METADATA_KEYS } from "@/lib/knots-compat";
import { KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";
import { backendErrorStatus } from "@/lib/backend-http";
import { buildHierarchy } from "@/lib/beat-hierarchy";
import { compareBeatsByPriorityThenState } from "@/lib/beat-sort";
import type { Beat, BeatWithRepo } from "@/lib/types";

// ── Mock store ──────────────────────────────────────────────

interface MockKnot {
  id: string;
  title: string;
  state: string;
  profile_id?: string;
  workflow_id?: string;
  updated_at: string;
  body: string | null;
  description: string | null;
  priority: number | null;
  type: string | null;
  tags: string[];
  notes: Array<Record<string, unknown>>;
  handoff_capsules: Array<Record<string, unknown>>;
  workflow_etag: string;
  created_at: string;
  profile_etag?: string | null;
}

interface MockEdge {
  src: string;
  kind: string;
  dst: string;
}

const store = {
  seq: 0,
  knots: new Map<string, MockKnot>(),
  edges: [] as MockEdge[],
};

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(): string {
  store.seq += 1;
  return `K-${String(store.seq).padStart(4, "0")}`;
}

function resetStore(): void {
  store.seq = 0;
  store.knots.clear();
  store.edges = [];
}

// ── Mock knots CLI ──────────────────────────────────────────

const AUTOPILOT_STATES = [
  "ready_for_planning",
  "planning",
  "ready_for_plan_review",
  "plan_review",
  "ready_for_implementation",
  "implementation",
  "ready_for_implementation_review",
  "implementation_review",
  "ready_for_shipment",
  "shipment",
  "ready_for_shipment_review",
  "shipment_review",
  "shipped",
];

const mockListProfiles = vi.fn(async () => ({
  ok: true as const,
  data: [
    {
      id: "autopilot",
      description: "Fully agent-owned profile",
      initial_state: "ready_for_planning",
      states: AUTOPILOT_STATES,
      terminal_states: ["shipped"],
      owners: {
        planning: { kind: "agent" as const },
        plan_review: { kind: "agent" as const },
        implementation: { kind: "agent" as const },
        implementation_review: { kind: "agent" as const },
        shipment: { kind: "agent" as const },
        shipment_review: { kind: "agent" as const },
      },
    },
  ],
}));

const mockListKnots = vi.fn(async () => ({
  ok: true as const,
  data: Array.from(store.knots.values()),
}));

const mockShowKnot = vi.fn(async (id: string) => {
  const knot = store.knots.get(id);
  if (!knot) return { ok: false as const, error: `knot '${id}' not found in local cache` };
  return { ok: true as const, data: knot };
});

const mockNewKnot = vi.fn(
  async (
    title: string,
    options?: { description?: string; state?: string; profile?: string },
  ) => {
    const id = nextId();
    const now = nowIso();
    store.knots.set(id, {
      id,
      title,
      state: options?.state ?? "ready_for_planning",
      profile_id: options?.profile ?? "autopilot",
      workflow_id: options?.profile ?? "autopilot",
      updated_at: now,
      body: options?.description ?? null,
      description: options?.description ?? null,
      priority: null,
      type: null,
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: `${id}-etag`,
      created_at: now,
    });
    return { ok: true as const, data: { id } };
  },
);

const mockUpdateKnot = vi.fn(
  async (id: string, input: Record<string, unknown>) => {
    const knot = store.knots.get(id);
    if (!knot) return { ok: false as const, error: `knot '${id}' not found in local cache` };
    if (typeof input.title === "string") knot.title = input.title;
    if (typeof input.description === "string") {
      knot.description = input.description;
      knot.body = input.description;
    }
    if (typeof input.priority === "number") knot.priority = input.priority;
    if (typeof input.status === "string") knot.state = input.status;
    if (typeof input.type === "string") knot.type = input.type;
    const addTags = Array.isArray(input.addTags) ? input.addTags.filter((v): v is string => typeof v === "string") : [];
    for (const tag of addTags) {
      if (!knot.tags.includes(tag)) knot.tags.push(tag);
    }
    if (typeof input.addNote === "string") {
      knot.notes.push({ content: input.addNote, username: "test", datetime: nowIso() });
    }
    knot.updated_at = nowIso();
    return { ok: true as const };
  },
);

const mockListEdges = vi.fn(
  async (id: string, _direction?: string) => {
    const edges = store.edges.filter((edge) => edge.src === id || edge.dst === id);
    return { ok: true as const, data: edges };
  },
);

const mockAddEdge = vi.fn(
  async (src: string, kind: string, dst: string) => {
    if (!store.edges.some((edge) => edge.src === src && edge.kind === kind && edge.dst === dst)) {
      store.edges.push({ src, kind, dst });
    }
    return { ok: true as const };
  },
);

const mockRemoveEdge = vi.fn(
  async (src: string, kind: string, dst: string) => {
    const idx = store.edges.findIndex((edge) => edge.src === src && edge.kind === kind && edge.dst === dst);
    if (idx === -1) return { ok: false as const, error: "edge not found" };
    store.edges.splice(idx, 1);
    return { ok: true as const };
  },
);

const mockClaimKnot = vi.fn(async (id: string) => {
  const knot = store.knots.get(id);
  if (!knot) return { ok: false as const, error: `knot '${id}' not found` };
  return {
    ok: true as const,
    data: { id: knot.id, title: knot.title, state: knot.state, profile_id: "autopilot", prompt: `# ${knot.title}` },
  };
});

const mockPollKnot = vi.fn(async () => {
  const claimable = Array.from(store.knots.values())
    .filter((k) => k.state.startsWith("ready_for_"))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  if (claimable.length === 0) return { ok: false as const, error: "no claimable knots found" };
  const knot = claimable[0]!;
  return {
    ok: true as const,
    data: { id: knot.id, title: knot.title, state: knot.state, profile_id: "autopilot", prompt: `# ${knot.title}` },
  };
});

vi.mock("@/lib/knots", () => ({
  listProfiles: () => mockListProfiles(),
  listWorkflows: () => Promise.resolve({ ok: true, data: [] }),
  listKnots: () => mockListKnots(),
  showKnot: (id: string) => mockShowKnot(id),
  newKnot: (title: string, options?: Record<string, unknown>) => mockNewKnot(title, options as Parameters<typeof mockNewKnot>[1]),
  updateKnot: (id: string, input: Record<string, unknown>) => mockUpdateKnot(id, input),
  listEdges: (id: string, direction?: string) => mockListEdges(id, direction),
  addEdge: (src: string, kind: string, dst: string) => mockAddEdge(src, kind, dst),
  removeEdge: (src: string, kind: string, dst: string) => mockRemoveEdge(src, kind, dst),
  claimKnot: (id: string) => mockClaimKnot(id),
  pollKnot: () => mockPollKnot(),
  skillPrompt: vi.fn(async () => ({ ok: true as const, data: "Skill prompt placeholder" })),
  nextKnot: vi.fn(async () => ({ ok: true as const })),
}));

import { KnotsBackend } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── g3y1.5.1: Raw state preserved in metadata ──────────────

describe("Knots-state compression with raw state metadata", () => {
  it("preserves raw Knots state in Beat.metadata.knotsState", async () => {
    const now = nowIso();
    store.knots.set("K-raw", {
      id: "K-raw",
      title: "Raw state test",
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
      workflow_etag: "etag-1",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.get("K-raw");
    expect(result.ok).toBe(true);
    const beat = result.data!;

    // The metadata must contain the raw Knots state
    expect(beat.metadata).toBeDefined();
    expect(beat.metadata![KNOTS_METADATA_KEYS.state]).toBe("ready_for_implementation");
    expect(beat.metadata![KNOTS_METADATA_KEYS.profileId]).toBe("autopilot");
  });

  it("preserves raw state even when workflow normalizes it", async () => {
    const now = nowIso();
    store.knots.set("K-norm", {
      id: "K-norm",
      title: "Normalized state test",
      state: "implementation",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 0,
      type: "task",
      tags: ["urgent"],
      notes: [{ content: "started work", username: "agent", datetime: now }],
      handoff_capsules: [{ content: "handoff data", username: "agent", datetime: now }],
      workflow_etag: "etag-2",
      created_at: now,
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.get("K-norm");
    expect(result.ok).toBe(true);
    const beat = result.data!;

    // rollbackActivePhase maps "implementation" → "ready_for_implementation" for non-locked beats
    expect(beat.state).toBe("ready_for_implementation");
    expect(beat.metadata![KNOTS_METADATA_KEYS.state]).toBe("implementation");
    expect(beat.metadata![KNOTS_METADATA_KEYS.handoffCapsules]).toBeInstanceOf(Array);
    expect(beat.metadata![KNOTS_METADATA_KEYS.notes]).toBeInstanceOf(Array);
  });

  it("preserves profile etag and workflow etag in metadata", async () => {
    const now = nowIso();
    store.knots.set("K-etag", {
      id: "K-etag",
      title: "Etag test",
      state: "ready_for_planning",
      profile_id: "autopilot",
      workflow_id: "autopilot",
      updated_at: now,
      body: null,
      description: null,
      priority: 2,
      type: "work",
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_etag: "wf-etag-xyz",
      created_at: now,
      profile_etag: "prof-etag-abc",
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.get("K-etag");
    expect(result.ok).toBe(true);

    const md = result.data!.metadata!;
    expect(md[KNOTS_METADATA_KEYS.workflowEtag]).toBe("wf-etag-xyz");
    expect(md[KNOTS_METADATA_KEYS.profileEtag]).toBe("prof-etag-abc");
  });
});

// ── g3y1.5.2: Capability-aware API guard behavior ───────────

describe("Capability-aware API guard behavior", () => {
  it("KNOTS_CAPABILITIES has canDelete=false", () => {
    expect(KNOTS_CAPABILITIES.canDelete).toBe(false);
  });

  it("KNOTS_CAPABILITIES has canSync=true", () => {
    expect(KNOTS_CAPABILITIES.canSync).toBe(true);
  });

  it("KnotsBackend.delete() returns UNSUPPORTED error", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete("any-id");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNSUPPORTED");
    expect(result.error!.retryable).toBe(false);
  });

  it("UNSUPPORTED error maps to HTTP 405", () => {
    const status = backendErrorStatus({
      code: "UNSUPPORTED",
      message: "Operation not supported",
      retryable: false,
    });
    expect(status).toBe(405);
  });

  it("KnotsBackend.update() rejects profileId changes with INVALID_INPUT", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Profile change test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);

    const result = await backend.update(created.data!.id, { profileId: "new-profile" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("backend error codes map to non-500 HTTP statuses", () => {
    // Verify that all structured error codes from backends map to explicit HTTP statuses
    const nonGenericCodes = [
      { code: "NOT_FOUND", expected: 404 },
      { code: "ALREADY_EXISTS", expected: 409 },
      { code: "INVALID_INPUT", expected: 400 },
      { code: "LOCKED", expected: 423 },
      { code: "TIMEOUT", expected: 504 },
      { code: "UNAVAILABLE", expected: 503 },
      { code: "UNSUPPORTED", expected: 405 },
      { code: "PERMISSION_DENIED", expected: 403 },
      { code: "CONFLICT", expected: 409 },
      { code: "RATE_LIMITED", expected: 429 },
    ];

    for (const { code, expected } of nonGenericCodes) {
      const status = backendErrorStatus({ code, message: "test", retryable: false });
      expect(status).toBe(expected);
    }
  });
});

// ── g3y1.5.3: Table/filter/sort/hierarchy for Knots repos ───

describe("Table/filter/sort/hierarchy views on Knots repos", () => {
  async function seedKnots() {
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

  describe("filter by state", () => {
    it("filters by 'queued' (ready_for_* states)", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "queued" });
      expect(result.ok).toBe(true);
      const ids = result.data!.map((b) => b.id);
      expect(ids).toContain("g3y1.1");
      expect(ids).toContain("g3y1.1.1");
      // rollbackActivePhase maps implementation → ready_for_implementation (queued)
      expect(ids).toContain("g3y1");
      expect(ids).not.toContain("g3y1.2"); // shipped, not queued
    });

    it("filters by 'in_action' (action states)", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "in_action" });
      expect(result.ok).toBe(true);
      const ids = result.data!.map((b) => b.id);
      // rollbackActivePhase maps implementation → ready_for_implementation (queued)
      expect(ids).not.toContain("g3y1");
      expect(ids).not.toContain("g3y1.1"); // ready_for_implementation is queued
    });

    it("filters by exact state name", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "shipped" });
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1.2");
    });
  });

  describe("filter by type", () => {
    it("filters by type='epic'", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ type: "epic" });
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1");
    });

    it("filters by type='task'", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ type: "task" });
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(3);
    });
  });

  describe("filter by priority", () => {
    it("filters by priority=0", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ priority: 0 });
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1");
    });
  });

  describe("filter by label", () => {
    it("filters by label", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ label: "bug" });
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1.2");
    });
  });

  describe("hierarchy", () => {
    it("infers parent from hierarchical dotted IDs", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list();
      expect(result.ok).toBe(true);

      const beats = result.data!;
      const child1 = beats.find((b) => b.id === "g3y1.1");
      const child2 = beats.find((b) => b.id === "g3y1.2");
      const grandchild = beats.find((b) => b.id === "g3y1.1.1");

      expect(child1?.parent).toBe("g3y1");
      expect(child2?.parent).toBe("g3y1");
      expect(grandchild?.parent).toBe("g3y1.1");
    });

    it("builds hierarchical tree from flat beats", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list();
      expect(result.ok).toBe(true);

      const hierarchical = buildHierarchy(result.data!);
      expect(hierarchical.length).toBeGreaterThan(0);

      const root = hierarchical.find((h) => h.id === "g3y1");
      expect(root).toBeDefined();
      expect(root!._depth).toBe(0);
      expect(root!._hasChildren).toBe(true);
    });
  });

  describe("sort", () => {
    it("sorts by priority then state", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.list();
      expect(result.ok).toBe(true);

      const sorted = [...result.data!].sort(compareBeatsByPriorityThenState);
      // Priority 0 first, then 1, 2, 3
      expect(sorted[0].priority).toBe(0);
      expect(sorted[sorted.length - 1].priority).toBe(3);
    });
  });

  describe("search", () => {
    it("searches across title and description", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.search("Grandchild");
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1.1.1");
    });

    it("searches by partial ID match", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.search("g3y1.1");
      expect(result.ok).toBe(true);
      // Should match g3y1.1 and g3y1.1.1
      expect(result.data!.length).toBe(2);
    });
  });

  describe("query expressions", () => {
    it("query by type:task", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.query("type:task");
      expect(result.ok).toBe(true);
      for (const beat of result.data!) {
        expect(beat.type).toBe("task");
      }
    });

    it("query by state:shipped", async () => {
      await seedKnots();
      const backend = new KnotsBackend("/repo");
      const result = await backend.query("state:shipped");
      expect(result.ok).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].id).toBe("g3y1.2");
    });
  });
});

// ── g3y1.5.4: Mixed All Repositories behavior ──────────────

describe("Mixed All Repositories behavior", () => {
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

    // Simulate the multi-repo annotation that the page.tsx does
    const beatsWithRepo: BeatWithRepo[] = result.data!.map((beat) => ({
      ...beat,
      _repoPath: "/repo-a",
      _repoName: "repo-a",
    }));

    expect(beatsWithRepo[0]._repoPath).toBe("/repo-a");
    expect(beatsWithRepo[0]._repoName).toBe("repo-a");
    expect(beatsWithRepo[0].id).toBe("K-multi");
  });

  it("beats from different backends can be concatenated", async () => {
    // Simulate a Knots beat
    const knotsBeat: BeatWithRepo = {
      id: "knot-1",
      title: "Knots beat",
      type: "work",
      state: "ready_for_implementation",
      priority: 1,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
      metadata: { [KNOTS_METADATA_KEYS.state]: "ready_for_implementation" },
      _repoPath: "/knots-repo",
      _repoName: "knots-repo",
    };

    // Simulate a Beads beat
    const beadsBeat: BeatWithRepo = {
      id: "bead-1",
      title: "Beads beat",
      type: "task",
      state: "open",
      priority: 2,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
      _repoPath: "/beads-repo",
      _repoName: "beads-repo",
    };

    // Mixed view: concatenate beats from both backends
    const allBeats = [knotsBeat, beadsBeat];
    expect(allBeats).toHaveLength(2);
    expect(allBeats[0]._repoName).toBe("knots-repo");
    expect(allBeats[1]._repoName).toBe("beads-repo");

    // Both have valid state fields
    expect(allBeats[0].state).toBeDefined();
    expect(allBeats[1].state).toBeDefined();
  });

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

    const beadsBeat: Beat = {
      id: "bead-1",
      title: "Beads P2",
      type: "task",
      state: "open",
      priority: 2,
      labels: [],
      created: nowIso(),
      updated: nowIso(),
    };

    const sorted = [beadsBeat, knotsBeat].sort(compareBeatsByPriorityThenState);
    expect(sorted[0].id).toBe("knot-1"); // P0 comes first
    expect(sorted[1].id).toBe("bead-1"); // P2 comes second
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
        id: "beads-123",
        title: "Beads task",
        type: "task",
        state: "open",
        priority: 2,
        labels: [],
        created: nowIso(),
        updated: nowIso(),
      },
    ];

    const hierarchical = buildHierarchy(beats);
    // Root-level items: g3y1 (parent) and beads-123 (no parent)
    const roots = hierarchical.filter((h) => h._depth === 0);
    expect(roots.length).toBe(2);

    const parent = hierarchical.find((h) => h.id === "g3y1");
    expect(parent!._hasChildren).toBe(true);

    const beadItem = hierarchical.find((h) => h.id === "beads-123");
    expect(beadItem!._hasChildren).toBe(false);
    expect(beadItem!._depth).toBe(0);
  });
});
