/**
 * Knots Backend Contract Parity Tests
 *
 * Exercises Knots-specific capability-gated behaviour that the generic
 * contract harness does not cover.  Validates capability flags, the
 * unsupported-delete error path, workflow descriptor shape, and the
 * close -> shipped state mapping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory mock store (mirrors the pattern in knots-backend.test.ts)
// ---------------------------------------------------------------------------

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
  return `P-${String(store.seq).padStart(4, "0")}`;
}

function resetStore(): void {
  store.seq = 0;
  store.knots.clear();
  store.edges = [];
}

// ---------------------------------------------------------------------------
// Mock functions
// ---------------------------------------------------------------------------

const PROFILE_STATES = [
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

const mockListProfiles = vi.fn(async (_repoPath?: string) => ({
  ok: true as const,
  data: [
    {
      id: "autopilot",
      description: "Fully agent-owned profile",
      initial_state: "ready_for_planning",
      states: PROFILE_STATES,
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

const mockListKnots = vi.fn(async (_repoPath?: string) => ({
  ok: true as const,
  data: Array.from(store.knots.values()),
}));

const mockShowKnot = vi.fn(async (id: string, _repoPath?: string) => {
  const knot = store.knots.get(id);
  if (!knot) {
    return { ok: false as const, error: `knot '${id}' not found in local cache` };
  }
  return { ok: true as const, data: knot };
});

const mockNewKnot = vi.fn(
  async (
    title: string,
    options?: { description?: string; state?: string; profile?: string },
    _repoPath?: string,
  ) => {
    const id = nextId();
    const now = nowIso();
    const profileId = options?.profile ?? "autopilot";
    store.knots.set(id, {
      id,
      title,
      state: options?.state ?? "ready_for_planning",
      profile_id: profileId,
      workflow_id: profileId,
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
  async (id: string, input: Record<string, unknown>, _repoPath?: string) => {
    const knot = store.knots.get(id);
    if (!knot) {
      return { ok: false as const, error: `knot '${id}' not found in local cache` };
    }
    if (typeof input.title === "string") knot.title = input.title;
    if (typeof input.description === "string") {
      knot.description = input.description;
      knot.body = input.description;
    }
    if (typeof input.priority === "number") knot.priority = input.priority;
    if (typeof input.status === "string") knot.state = input.status;
    if (typeof input.type === "string") knot.type = input.type;
    if (typeof input.addNote === "string") {
      knot.notes.push({ content: input.addNote, datetime: nowIso() });
    }
    knot.updated_at = nowIso();
    return { ok: true as const };
  },
);

const mockListEdges = vi.fn(
  async (id: string, direction: string = "both", _repoPath?: string) => {
    const edges = store.edges.filter((edge) => {
      if (direction === "incoming") return edge.dst === id;
      if (direction === "outgoing") return edge.src === id;
      return edge.src === id || edge.dst === id;
    });
    return { ok: true as const, data: edges };
  },
);

const mockAddEdge = vi.fn(
  async (src: string, kind: string, dst: string, _repoPath?: string) => {
    store.edges.push({ src, kind, dst });
    return { ok: true as const };
  },
);

const mockRemoveEdge = vi.fn(
  async (src: string, kind: string, dst: string, _repoPath?: string) => {
    const idx = store.edges.findIndex(
      (e) => e.src === src && e.kind === kind && e.dst === dst,
    );
    if (idx === -1) return { ok: false as const, error: "edge not found" };
    store.edges.splice(idx, 1);
    return { ok: true as const };
  },
);

const mockClaimKnot = vi.fn(
  async (id: string, _repoPath?: string, _options?: Record<string, unknown>) => {
    const knot = store.knots.get(id);
    if (!knot) return { ok: false as const, error: `knot '${id}' not found` };
    return { ok: true as const, data: { id, prompt: `# ${knot.title}` } };
  },
);

const mockPollKnot = vi.fn(
  async (_repoPath?: string, _options?: Record<string, unknown>) => {
    return { ok: false as const, error: "no claimable knots found" };
  },
);

// ---------------------------------------------------------------------------
// Wire mocks before importing the backend
// ---------------------------------------------------------------------------

vi.mock("@/lib/knots", () => ({
  listProfiles: (repoPath?: string) => mockListProfiles(repoPath),
  listWorkflows: () => ({ ok: true, data: [] }),
  listKnots: (repoPath?: string) => mockListKnots(repoPath),
  showKnot: (id: string, repoPath?: string) => mockShowKnot(id, repoPath),
  newKnot: (
    title: string,
    options?: Record<string, unknown>,
    repoPath?: string,
  ) => mockNewKnot(title, options as never, repoPath),
  updateKnot: (id: string, input: Record<string, unknown>, repoPath?: string) =>
    mockUpdateKnot(id, input, repoPath),
  listEdges: (id: string, direction: string, repoPath?: string) =>
    mockListEdges(id, direction, repoPath),
  addEdge: (src: string, kind: string, dst: string, repoPath?: string) =>
    mockAddEdge(src, kind, dst, repoPath),
  removeEdge: (src: string, kind: string, dst: string, repoPath?: string) =>
    mockRemoveEdge(src, kind, dst, repoPath),
  claimKnot: (id: string, repoPath?: string, options?: Record<string, unknown>) =>
    mockClaimKnot(id, repoPath, options),
  pollKnot: (repoPath?: string, options?: Record<string, unknown>) =>
    mockPollKnot(repoPath, options),
  skillPrompt: vi.fn(async () => ({ ok: true as const, data: "Skill prompt placeholder" })),
  nextKnot: vi.fn(async () => ({ ok: true as const })),
}));

import { KnotsBackend, KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe("Knots capability flags", () => {
  it("canDelete is false", () => {
    expect(KNOTS_CAPABILITIES.canDelete).toBe(false);
  });

  it("canSync is true", () => {
    expect(KNOTS_CAPABILITIES.canSync).toBe(true);
  });

  it("canCreate is true", () => {
    expect(KNOTS_CAPABILITIES.canCreate).toBe(true);
  });

  it("canUpdate is true", () => {
    expect(KNOTS_CAPABILITIES.canUpdate).toBe(true);
  });

  it("canClose is true", () => {
    expect(KNOTS_CAPABILITIES.canClose).toBe(true);
  });

  it("canSearch is true", () => {
    expect(KNOTS_CAPABILITIES.canSearch).toBe(true);
  });

  it("canQuery is true", () => {
    expect(KNOTS_CAPABILITIES.canQuery).toBe(true);
  });

  it("canListReady is true", () => {
    expect(KNOTS_CAPABILITIES.canListReady).toBe(true);
  });

  it("canManageDependencies is true", () => {
    expect(KNOTS_CAPABILITIES.canManageDependencies).toBe(true);
  });

  it("canManageLabels is true", () => {
    expect(KNOTS_CAPABILITIES.canManageLabels).toBe(true);
  });

  it("maxConcurrency is 1", () => {
    expect(KNOTS_CAPABILITIES.maxConcurrency).toBe(1);
  });

  it("instance capabilities match the exported constant", () => {
    const backend = new KnotsBackend("/repo");
    expect(backend.capabilities).toEqual(KNOTS_CAPABILITIES);
  });
});

describe("Knots delete() capability gate", () => {
  it("returns error with UNSUPPORTED code when delete is attempted", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete("any-id");

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNSUPPORTED");
    expect(result.error!.message).toContain("not supported");
  });

  it("error is not retryable", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete("any-id");

    expect(result.ok).toBe(false);
    expect(result.error!.retryable).toBe(false);
  });
});

describe("Knots listWorkflows() descriptor shape", () => {
  it("returns workflow descriptors with expected fields", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.listWorkflows();

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);

    for (const descriptor of result.data!) {
      expect(typeof descriptor.id).toBe("string");
      expect(typeof descriptor.backingWorkflowId).toBe("string");
      expect(typeof descriptor.label).toBe("string");
      expect(typeof descriptor.mode).toBe("string");
      expect(typeof descriptor.initialState).toBe("string");
      expect(Array.isArray(descriptor.states)).toBe(true);
      expect(descriptor.states.length).toBeGreaterThan(0);
      expect(Array.isArray(descriptor.terminalStates)).toBe(true);
      expect(descriptor.terminalStates.length).toBeGreaterThan(0);
      expect(typeof descriptor.retakeState).toBe("string");
      expect(typeof descriptor.promptProfileId).toBe("string");
    }
  });

  it("descriptors include queue, action, and review state arrays", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.listWorkflows();

    expect(result.ok).toBe(true);
    for (const descriptor of result.data!) {
      expect(Array.isArray(descriptor.queueStates)).toBe(true);
      expect(Array.isArray(descriptor.actionStates)).toBe(true);
      expect(Array.isArray(descriptor.reviewQueueStates)).toBe(true);
      expect(Array.isArray(descriptor.humanQueueStates)).toBe(true);
    }
  });

  it("profileId on descriptor matches id", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.listWorkflows();

    expect(result.ok).toBe(true);
    for (const descriptor of result.data!) {
      expect(descriptor.profileId).toBe(descriptor.id);
    }
  });
});

describe("Knots close() -> shipped state mapping", () => {
  it("close() transitions a beat to shipped state", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Parity close test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);
    const id = created.data!.id;

    const closeResult = await backend.close(id, "completed");
    expect(closeResult.ok).toBe(true);

    const fetched = await backend.get(id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data!.state).toBe("shipped");
  });

  it("close() sets force flag on the underlying update", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Force flag test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);
    const id = created.data!.id;

    await backend.close(id, "done");

    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![1]).toMatchObject({ status: "shipped", force: true });
  });

  it("close() with reason adds a note", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "Reason note test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);
    const id = created.data!.id;

    await backend.close(id, "no longer needed");

    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastCall![1]).toMatchObject({
      addNote: "Close reason: no longer needed",
    });
  });

  it("close() without reason omits the addNote field", async () => {
    const backend = new KnotsBackend("/repo");
    const created = await backend.create({
      title: "No reason test",
      type: "task",
      priority: 2,
      labels: [],
    });
    expect(created.ok).toBe(true);
    const id = created.data!.id;

    await backend.close(id);

    const lastCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastCall![1]).toMatchObject({ status: "shipped", force: true });
    expect(lastCall![1]).toHaveProperty("addNote", undefined);
  });
});
