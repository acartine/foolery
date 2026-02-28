import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBackendContractTests } from "./backend-contract.test";

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
  return `K-${String(store.seq).padStart(4, "0")}`;
}

function resetStore(): void {
  store.seq = 0;
  store.knots.clear();
  store.edges = [];
}

const mockListKnots = vi.fn(async (_repoPath?: string) => {
  return { ok: true as const, data: Array.from(store.knots.values()) };
});

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
    options?: { body?: string; description?: string; state?: string; profile?: string; workflow?: string },
    _repoPath?: string,
  ) => {
    const id = nextId();
    const now = nowIso();
    const profileId = options?.profile ?? options?.workflow ?? "autopilot";
    const description = options?.description ?? options?.body ?? null;
    store.knots.set(id, {
      id,
      title,
      state: options?.state ?? "ready_for_planning",
      profile_id: profileId,
      workflow_id: profileId,
      updated_at: now,
      body: description,
      description,
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

const mockListWorkflows = vi.fn(async (_repoPath?: string) => {
  return {
    ok: true as const,
    data: [
      {
        id: "granular",
        description: "Highly automated granular workflow",
        initial_state: "work_item",
        states: ["work_item", "implementing", "shipped"],
        terminal_states: ["shipped"],
      },
      {
        id: "coarse",
        description: "Human gated coarse workflow",
        initial_state: "work_item",
        states: ["work_item", "implementing", "reviewing", "shipped"],
        terminal_states: ["shipped"],
      },
    ],
  };
});

const mockListProfiles = vi.fn(async (_repoPath?: string) => {
  const states = [
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
  return {
    ok: true as const,
    data: [
      {
        id: "autopilot",
        description: "Fully agent-owned profile",
        initial_state: "ready_for_planning",
        states,
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
      {
        id: "semiauto",
        description: "Human-gated reviews profile",
        initial_state: "ready_for_planning",
        states,
        terminal_states: ["shipped"],
        owners: {
          planning: { kind: "agent" as const },
          plan_review: { kind: "human" as const },
          implementation: { kind: "agent" as const },
          implementation_review: { kind: "human" as const },
          shipment: { kind: "agent" as const },
          shipment_review: { kind: "human" as const },
        },
      },
    ],
  };
});

const mockUpdateKnot = vi.fn(async (id: string, input: Record<string, unknown>, _repoPath?: string) => {
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

  const addTags = Array.isArray(input.addTags) ? input.addTags.filter((v): v is string => typeof v === "string") : [];
  const removeTags = Array.isArray(input.removeTags)
    ? input.removeTags.filter((v): v is string => typeof v === "string")
    : [];

  for (const tag of addTags) {
    if (!knot.tags.includes(tag)) knot.tags.push(tag);
  }
  if (removeTags.length > 0) {
    knot.tags = knot.tags.filter((tag) => !removeTags.includes(tag));
  }

  if (typeof input.addNote === "string") {
    knot.notes.push({
      content: input.addNote,
      username: input.noteUsername ?? "unknown",
      datetime: input.noteDatetime ?? nowIso(),
      agentname: input.noteAgentname ?? "unknown",
      model: input.noteModel ?? "unknown",
      version: input.noteVersion ?? "unknown",
    });
  }

  if (typeof input.addHandoffCapsule === "string") {
    knot.handoff_capsules.push({
      content: input.addHandoffCapsule,
      username: input.handoffUsername ?? "unknown",
      datetime: input.handoffDatetime ?? nowIso(),
      agentname: input.handoffAgentname ?? "unknown",
      model: input.handoffModel ?? "unknown",
      version: input.handoffVersion ?? "unknown",
    });
  }

  knot.updated_at = nowIso();
  return { ok: true as const };
});

const mockListEdges = vi.fn(
  async (
    id: string,
    direction: "incoming" | "outgoing" | "both" = "both",
    _repoPath?: string,
  ) => {
    const edges = store.edges.filter((edge) => {
      if (direction === "incoming") return edge.dst === id;
      if (direction === "outgoing") return edge.src === id;
      return edge.src === id || edge.dst === id;
    });
    return { ok: true as const, data: edges };
  },
);

const mockAddEdge = vi.fn(async (src: string, kind: string, dst: string, _repoPath?: string) => {
  if (!store.knots.has(src) || !store.knots.has(dst)) {
    return { ok: false as const, error: `knot '${src}' or '${dst}' not found in local cache` };
  }

  if (!store.edges.some((edge) => edge.src === src && edge.kind === kind && edge.dst === dst)) {
    store.edges.push({ src, kind, dst });
  }
  return { ok: true as const };
});

const mockRemoveEdge = vi.fn(async (src: string, kind: string, dst: string, _repoPath?: string) => {
  const idx = store.edges.findIndex((edge) => edge.src === src && edge.kind === kind && edge.dst === dst);
  if (idx === -1) {
    return { ok: false as const, error: `edge not found: ${src} -[${kind}]-> ${dst}` };
  }
  store.edges.splice(idx, 1);
  return { ok: true as const };
});

vi.mock("@/lib/knots", () => ({
  listProfiles: (repoPath?: string) => mockListProfiles(repoPath),
  listWorkflows: (repoPath?: string) => mockListWorkflows(repoPath),
  listKnots: (repoPath?: string) => mockListKnots(repoPath),
  showKnot: (id: string, repoPath?: string) => mockShowKnot(id, repoPath),
  newKnot: (
    title: string,
    options?: { body?: string; description?: string; state?: string; profile?: string; workflow?: string },
    repoPath?: string,
  ) => mockNewKnot(title, options, repoPath),
  updateKnot: (id: string, input: Record<string, unknown>, repoPath?: string) =>
    mockUpdateKnot(id, input, repoPath),
  listEdges: (id: string, direction: "incoming" | "outgoing" | "both" = "both", repoPath?: string) =>
    mockListEdges(id, direction, repoPath),
  addEdge: (src: string, kind: string, dst: string, repoPath?: string) =>
    mockAddEdge(src, kind, dst, repoPath),
  removeEdge: (src: string, kind: string, dst: string, repoPath?: string) =>
    mockRemoveEdge(src, kind, dst, repoPath),
}));

import { KnotsBackend, KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

runBackendContractTests("KnotsBackend (mocked knots CLI)", () => {
  const backend = new KnotsBackend("/repo");
  return {
    port: backend,
    capabilities: KNOTS_CAPABILITIES,
    cleanup: async () => {
      resetStore();
    },
  };
});

describe("KnotsBackend mapping behaviour", () => {
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
    expect(lastUpdateArgs?.[1]).toMatchObject({ status: "shipped", force: true });

    const fetched = await backend.get(created.data!.id);
    expect(fetched.ok).toBe(true);
    expect(fetched.data?.status).toBe("closed");
    expect((fetched.data?.metadata as Record<string, unknown>)?.knotsState).toBe("shipped");
  });

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

    const result = await backend.addDependency(blocker.data!.id, blocked.data!.id);
    expect(result.ok).toBe(true);
    expect(mockAddEdge).toHaveBeenCalledWith(blocked.data!.id, "blocked_by", blocker.data!.id, "/repo");
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

    const leaf = listed.data?.find((knot) => knot.id === "foolery-g3y1.6.4");
    const intermediate = listed.data?.find((knot) => knot.id === "foolery-g3y1.6");
    expect(leaf?.parent).toBe("foolery-g3y1.6");
    expect(intermediate?.parent).toBe("foolery-g3y1");
  });

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

    const child = listed.data?.find((knot) => knot.id === "foolery-g3y1.1");
    expect(child?.parent).toBe("foolery-g3y1");
  });

  it("returns INVALID_INPUT for delete", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete("K-unknown");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});
