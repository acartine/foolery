import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBackendContractTests } from "./backend-contract.test";

interface MockKnot {
  id: string;
  alias?: string;
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

const mockPollKnot = vi.fn(
  async (_repoPath?: string, options?: { stage?: string; agentName?: string; agentModel?: string; agentVersion?: string }) => {
    // Find the highest-priority claimable knot from the store
    const claimable = Array.from(store.knots.values())
      .filter((k) => k.state.startsWith("ready_for_"))
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    if (claimable.length === 0) {
      return { ok: false as const, error: "no claimable knots found" };
    }
    const knot = claimable[0]!;
    return {
      ok: true as const,
      data: {
        id: knot.id,
        title: knot.title,
        state: knot.state,
        profile_id: knot.profile_id ?? "autopilot",
        type: knot.type,
        priority: knot.priority,
        prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
      },
    };
  },
);

const mockClaimKnot = vi.fn(
  async (id: string, _repoPath?: string, _options?: { agentName?: string; agentModel?: string; agentVersion?: string }) => {
    const knot = store.knots.get(id);
    if (!knot) {
      return { ok: false as const, error: `knot '${id}' not found in local cache` };
    }
    return {
      ok: true as const,
      data: {
        id: knot.id,
        title: knot.title,
        state: knot.state,
        profile_id: knot.profile_id ?? "autopilot",
        type: knot.type,
        priority: knot.priority,
        prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
      },
    };
  },
);

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
  claimKnot: (id: string, repoPath?: string, options?: Record<string, unknown>) =>
    mockClaimKnot(id, repoPath, options),
  pollKnot: (repoPath?: string, options?: Record<string, unknown>) =>
    mockPollKnot(repoPath, options),
  skillPrompt: vi.fn(async () => ({ ok: true as const, data: "Skill prompt placeholder" })),
  nextKnot: vi.fn(async () => ({ ok: true as const })),
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
    expect(fetched.data?.state).toBe("shipped");
    expect((fetched.data?.metadata as Record<string, unknown>)?.knotsState).toBe("shipped");
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
    const beat = listed.data?.find((item) => item.id === "abandon-1");
    expect(beat?.state).toBe("abandoned");
    expect(beat?.metadata?.knotsState).toBe("abandoned");
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

  it("infers parent from hierarchical dotted alias when id has no dots", async () => {
    const now = nowIso();
    // Parent knot: id "8792", no alias
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
    // Child knot: id "c5cd", alias "brutus-8792.5" (singular, matching real CLI)
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

    const child = listed.data?.find((knot) => knot.id === "c5cd");
    expect(child?.parent).toBe("8792");
    // The alias should be surfaced in the beat's aliases array
    expect(child?.aliases).toEqual(["brutus-8792.5"]);
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

  it("returns UNSUPPORTED for delete", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.delete("K-unknown");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNSUPPORTED");
  });

  describe("buildTakePrompt", () => {
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
      expect(result.data?.prompt).toContain("KNOTS CLAIM MODE");
      expect(result.data?.prompt).toContain("kno claim");
      expect(result.data?.prompt).toContain("single-step authorization");
      expect(result.data?.prompt).toContain("Do not inspect, review, or advance later workflow states on your own.");
      expect(result.data?.claimed).toBe(false);
      expect(mockShowKnot).toHaveBeenCalledWith(id, "/repo");
      expect(mockClaimKnot).not.toHaveBeenCalled();
    });
  });

  describe("update() stuck active state handling", () => {
    it("skips status change when target state matches raw kno state", async () => {
      const backend = new KnotsBackend("/repo");
      const now = nowIso();
      // Knot is in "planning" in kno, but toBeat rolls it back to "ready_for_planning"
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

      // User selects "planning" from the UI (which sees "ready_for_planning")
      // This should NOT send status=planning to kno because it's already in planning
      const result = await backend.update("stuck-1", { state: "planning" });
      expect(result.ok).toBe(true);

      // No update call should have been made (no fields changed)
      const updateCalls = mockUpdateKnot.mock.calls.filter((c) => c[0] === "stuck-1");
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
      const beat = listed.data?.find((item) => item.id === "stuck-1b");
      expect(beat).toBeTruthy();
      if (!beat) return;

      // Simulate a persisted raw metadata value with inconsistent formatting.
      beat.metadata = {
        ...(beat.metadata ?? {}),
        knotsState: " PlAnNiNg ",
      };

      const getSpy = vi.spyOn(backend, "get").mockResolvedValue({ ok: true, data: beat });
      try {
        const result = await backend.update("stuck-1b", { state: "planning" });
        expect(result.ok).toBe(true);
      } finally {
        getSpy.mockRestore();
      }

      const updateCalls = mockUpdateKnot.mock.calls.filter((c) => c[0] === "stuck-1b");
      expect(updateCalls.length).toBe(0);
    });

    it("sets force=true when jumping to a non-adjacent state", async () => {
      const backend = new KnotsBackend("/repo");
      const now = nowIso();
      // Knot is in "planning" but user wants to jump to "ready_for_implementation"
      store.knots.set("stuck-2", {
        id: "stuck-2",
        title: "Force jump knot",
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

      // Jump from "planning" to "ready_for_implementation" (non-adjacent)
      const result = await backend.update("stuck-2", { state: "ready_for_implementation" });
      expect(result.ok).toBe(true);

      const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
      expect(lastUpdateArgs?.[1]).toMatchObject({
        status: "ready_for_implementation",
        force: true,
      });
    });

    it("sets force=true for rollback when raw kno metadata state is missing", async () => {
      const backend = new KnotsBackend("/repo");
      const now = nowIso();
      store.knots.set("stuck-2b", {
        id: "stuck-2b",
        title: "Force rollback knot",
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
      const beat = listed.data?.find((item) => item.id === "stuck-2b");
      expect(beat).toBeTruthy();
      if (!beat) return;

      const beatWithoutRawState = {
        ...beat,
        metadata: {
          ...(beat.metadata ?? {}),
          knotsState: undefined,
        },
      };

      const getSpy = vi.spyOn(backend, "get").mockResolvedValue({ ok: true, data: beatWithoutRawState });
      try {
        const result = await backend.update("stuck-2b", { state: "ready_for_implementation" });
        expect(result.ok).toBe(true);
      } finally {
        getSpy.mockRestore();
      }

      const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
      expect(lastUpdateArgs?.[1]).toMatchObject({
        status: "ready_for_implementation",
        force: true,
      });
    });

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

      const result = await backend.update("stuck-3", { state: "abandoned" });
      expect(result.ok).toBe(true);

      const lastUpdateArgs = mockUpdateKnot.mock.calls.at(-1);
      expect(lastUpdateArgs?.[1]).toMatchObject({
        status: "abandoned",
      });
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

      const result = await backend.buildPollPrompt({ agentName: "test-agent", agentModel: "test-model" });
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
      // Store is empty, no knots to poll
      const result = await backend.buildPollPrompt({ agentName: "test-agent" });
      expect(result.ok).toBe(false);
    });
  });

  describe("queue children inclusion", () => {
    function seedKnot(id: string, state: string, overrides?: Partial<MockKnot>) {
      const now = nowIso();
      store.knots.set(id, {
        id,
        title: `knot ${id}`,
        state,
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
        workflow_etag: `${id}-etag`,
        created_at: now,
        ...overrides,
      });
    }

    it("includes shipped/abandoned children when parent is in a queue state (queued filter)", async () => {
      // Parent in queue state
      seedKnot("parent-1", "ready_for_implementation", { type: "epic" });
      // Children in various non-queue states
      seedKnot("child-shipped", "shipped");
      seedKnot("child-abandoned", "abandoned");
      seedKnot("child-active", "implementation");
      seedKnot("child-queued", "ready_for_planning");
      // Unrelated beat - should NOT appear
      seedKnot("unrelated", "shipped");

      // Set up parent_of edges
      store.edges.push({ src: "parent-1", kind: "parent_of", dst: "child-shipped" });
      store.edges.push({ src: "parent-1", kind: "parent_of", dst: "child-abandoned" });
      store.edges.push({ src: "parent-1", kind: "parent_of", dst: "child-active" });
      store.edges.push({ src: "parent-1", kind: "parent_of", dst: "child-queued" });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "queued" });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((b) => b.id).sort();
      // Should include parent (queue state), child-queued (queue state),
      // AND child-shipped, child-abandoned, child-active (descendants of queue parent)
      expect(ids).toContain("parent-1");
      expect(ids).toContain("child-queued");
      expect(ids).toContain("child-shipped");
      expect(ids).toContain("child-abandoned");
      expect(ids).toContain("child-active");
      // Unrelated shipped beat should NOT be included
      expect(ids).not.toContain("unrelated");
    });

    it("includes deeply nested descendants of queue parents", async () => {
      seedKnot("root", "ready_for_planning", { type: "epic" });
      seedKnot("mid", "implementation");
      seedKnot("leaf", "shipped");

      store.edges.push({ src: "root", kind: "parent_of", dst: "mid" });
      store.edges.push({ src: "mid", kind: "parent_of", dst: "leaf" });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "queued" });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((b) => b.id).sort();
      expect(ids).toContain("root");
      expect(ids).toContain("mid");
      expect(ids).toContain("leaf");
    });

    it("includes children when using in_action filter and parent is in queue state", async () => {
      seedKnot("parent-q", "ready_for_implementation", { type: "epic" });
      seedKnot("child-impl", "implementation");
      seedKnot("child-done", "shipped");

      store.edges.push({ src: "parent-q", kind: "parent_of", dst: "child-impl" });
      store.edges.push({ src: "parent-q", kind: "parent_of", dst: "child-done" });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "in_action" });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((b) => b.id).sort();
      // child-impl passes the in_action filter directly
      expect(ids).toContain("child-impl");
      // child-done should be included because its parent is in a queue state
      expect(ids).toContain("child-done");
    });

    it("does not include children when using a specific state filter", async () => {
      seedKnot("parent-q", "ready_for_implementation", { type: "epic" });
      seedKnot("child-done", "shipped");

      store.edges.push({ src: "parent-q", kind: "parent_of", dst: "child-done" });

      const backend = new KnotsBackend("/repo");
      const result = await backend.list({ state: "ready_for_implementation" });
      expect(result.ok).toBe(true);

      const ids = result.data!.map((b) => b.id);
      expect(ids).toContain("parent-q");
      // Specific state filter should NOT include descendants
      expect(ids).not.toContain("child-done");
    });
  });
});
