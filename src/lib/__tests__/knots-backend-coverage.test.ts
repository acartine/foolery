/**
 * Additional coverage tests for KnotsBackend.
 *
 * Targets uncovered lines in knots-backend.ts, focusing on:
 *  - listDependencies parent_of edge handling (lines ~852-866)
 *  - buildTakePrompt parent/scene mode (lines ~917-940)
 *  - classifyKnotsError edge cases
 *  - matchExpression filter fields
 *  - applyFilters edge cases
 *  - stringifyNotes variations
 *  - normalizePriority edge values
 *  - update with parent changes
 *  - search and query operations
 *  - removeDependency
 *  - listReady with blocked edges
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  profile_etag?: string;
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
  return `KC-${String(store.seq).padStart(4, "0")}`;
}

function resetStore(): void {
  store.seq = 0;
  store.knots.clear();
  store.edges = [];
}

// ── Mock implementations ────────────────────────────────────

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
    ],
  };
});

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

    const addTags = Array.isArray(input.addTags)
      ? input.addTags.filter((v): v is string => typeof v === "string")
      : [];
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
        username: "test",
        datetime: nowIso(),
      });
    }
    knot.updated_at = nowIso();
    return { ok: true as const };
  },
);

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

const mockAddEdge = vi.fn(
  async (src: string, kind: string, dst: string, _repoPath?: string) => {
    if (!store.knots.has(src) || !store.knots.has(dst)) {
      return {
        ok: false as const,
        error: `knot '${src}' or '${dst}' not found in local cache`,
      };
    }
    if (
      !store.edges.some(
        (edge) => edge.src === src && edge.kind === kind && edge.dst === dst,
      )
    ) {
      store.edges.push({ src, kind, dst });
    }
    return { ok: true as const };
  },
);

const mockRemoveEdge = vi.fn(
  async (src: string, kind: string, dst: string, _repoPath?: string) => {
    const idx = store.edges.findIndex(
      (edge) => edge.src === src && edge.kind === kind && edge.dst === dst,
    );
    if (idx === -1) {
      return {
        ok: false as const,
        error: `edge not found: ${src} -[${kind}]-> ${dst}`,
      };
    }
    store.edges.splice(idx, 1);
    return { ok: true as const };
  },
);

const mockClaimKnot = vi.fn(
  async (
    id: string,
    _repoPath?: string,
    _options?: Record<string, unknown>,
  ) => {
    const knot = store.knots.get(id);
    if (!knot) {
      return {
        ok: false as const,
        error: `knot '${id}' not found in local cache`,
      };
    }
    return {
      ok: true as const,
      data: {
        id: knot.id,
        title: knot.title,
        state: knot.state,
        profile_id: knot.profile_id ?? "autopilot",
        prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
      },
    };
  },
);

const mockPollKnot = vi.fn(
  async (
    _repoPath?: string,
    _options?: Record<string, unknown>,
  ) => {
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
        prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
      },
    };
  },
);

const mockSkillPrompt = vi.fn(
  async (_stateOrId: string, _repoPath?: string): Promise<{ ok: true; data: string } | { ok: false; error: string }> => {
    return { ok: true as const, data: "Skill prompt placeholder" };
  },
);

const mockNextKnot = vi.fn(
  async (
    _id: string,
    _repoPath?: string,
    _options?: Record<string, unknown>,
  ) => {
    return { ok: true as const };
  },
);

vi.mock("@/lib/knots", () => ({
  listProfiles: (repoPath?: string) => mockListProfiles(repoPath),
  listWorkflows: vi.fn(async () => ({ ok: true as const, data: [] })),
  listKnots: (repoPath?: string) => mockListKnots(repoPath),
  showKnot: (id: string, repoPath?: string) => mockShowKnot(id, repoPath),
  newKnot: (
    title: string,
    options?: Record<string, unknown>,
    repoPath?: string,
  ) => mockNewKnot(title, options as never, repoPath),
  updateKnot: (
    id: string,
    input: Record<string, unknown>,
    repoPath?: string,
  ) => mockUpdateKnot(id, input, repoPath),
  listEdges: (
    id: string,
    direction: "incoming" | "outgoing" | "both",
    repoPath?: string,
  ) => mockListEdges(id, direction, repoPath),
  addEdge: (src: string, kind: string, dst: string, repoPath?: string) =>
    mockAddEdge(src, kind, dst, repoPath),
  removeEdge: (src: string, kind: string, dst: string, repoPath?: string) =>
    mockRemoveEdge(src, kind, dst, repoPath),
  claimKnot: (
    id: string,
    repoPath?: string,
    options?: Record<string, unknown>,
  ) => mockClaimKnot(id, repoPath, options),
  pollKnot: (repoPath?: string, options?: Record<string, unknown>) =>
    mockPollKnot(repoPath, options),
  skillPrompt: (stateOrId: string, repoPath?: string) =>
    mockSkillPrompt(stateOrId, repoPath),
  nextKnot: (id: string, repoPath?: string, options?: Record<string, unknown>) =>
    mockNextKnot(id, repoPath, options),
}));

import { KnotsBackend } from "@/lib/backends/knots-backend";

// ── Setup ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── Helper ──────────────────────────────────────────────────

function insertKnot(overrides: Partial<MockKnot> & { id: string }): void {
  const now = nowIso();
  store.knots.set(overrides.id, {
    id: overrides.id,
    title: overrides.title ?? "Untitled",
    state: overrides.state ?? "ready_for_planning",
    profile_id: overrides.profile_id ?? "autopilot",
    workflow_id: overrides.workflow_id ?? "autopilot",
    updated_at: overrides.updated_at ?? now,
    body: overrides.body ?? null,
    description: overrides.description ?? null,
    priority: overrides.priority ?? null,
    type: overrides.type ?? null,
    tags: overrides.tags ?? [],
    notes: overrides.notes ?? [],
    handoff_capsules: overrides.handoff_capsules ?? [],
    workflow_etag: overrides.workflow_etag ?? "etag",
    profile_etag: overrides.profile_etag,
    created_at: overrides.created_at ?? now,
  });
}

// ── Tests ───────────────────────────────────────────────────

describe("KnotsBackend coverage: listDependencies parent_of edges", () => {
  it("returns parent_of dependencies for a parent knot", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "P1", title: "Parent" });
    insertKnot({ id: "C1", title: "Child" });
    store.edges.push({ src: "P1", kind: "parent_of", dst: "C1" });

    const result = await backend.listDependencies("P1");
    expect(result.ok).toBe(true);
    const parentDeps = result.data?.filter((d) => d.dependency_type === "parent_of");
    expect(parentDeps?.length).toBeGreaterThan(0);
    expect(parentDeps?.[0]?.id).toBe("C1");
    expect(parentDeps?.[0]?.source).toBe("P1");
    expect(parentDeps?.[0]?.target).toBe("C1");
  });

  it("returns parent_of dependencies for a child knot", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "P2", title: "Parent" });
    insertKnot({ id: "C2", title: "Child" });
    store.edges.push({ src: "P2", kind: "parent_of", dst: "C2" });

    const result = await backend.listDependencies("C2");
    expect(result.ok).toBe(true);
    const parentDeps = result.data?.filter((d) => d.dependency_type === "parent_of");
    expect(parentDeps?.length).toBeGreaterThan(0);
    expect(parentDeps?.[0]?.id).toBe("P2");
  });

  it("filters blocked_by dependencies by type option", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "A1", title: "A" });
    insertKnot({ id: "B1", title: "B" });
    insertKnot({ id: "C1", title: "C" });
    store.edges.push({ src: "A1", kind: "blocked_by", dst: "B1" });
    store.edges.push({ src: "A1", kind: "parent_of", dst: "C1" });

    // When type is "blocks", blocked_by edges should be included
    const result = await backend.listDependencies("A1", undefined, { type: "blocks" });
    expect(result.ok).toBe(true);
    const blockDeps = result.data?.filter((d) => d.dependency_type === "blocked_by");
    expect(blockDeps?.length).toBe(1);
    // parent_of edges are always included regardless of type filter
    const parentDeps = result.data?.filter((d) => d.dependency_type === "parent_of");
    expect(parentDeps?.length).toBe(1);
  });

  it("excludes blocked_by edges when type filter is not blocks", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "D1", title: "D" });
    insertKnot({ id: "E1", title: "E" });
    store.edges.push({ src: "D1", kind: "blocked_by", dst: "E1" });

    const result = await backend.listDependencies("D1", undefined, { type: "parent-child" });
    expect(result.ok).toBe(true);
    // blocked_by edges should be filtered out when type is not "blocks"
    const blockDeps = result.data?.filter((d) => d.dependency_type === "blocked_by");
    expect(blockDeps?.length).toBe(0);
  });

  it("returns both blocked_by and parent_of dependencies", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "X1", title: "Main" });
    insertKnot({ id: "X2", title: "Blocker" });
    insertKnot({ id: "X3", title: "Child" });
    store.edges.push({ src: "X1", kind: "blocked_by", dst: "X2" });
    store.edges.push({ src: "X1", kind: "parent_of", dst: "X3" });

    const result = await backend.listDependencies("X1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(2);
  });

  it("skips blocked_by edges where id is neither src nor dst", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "M1", title: "Main" });
    insertKnot({ id: "M2", title: "Other1" });
    insertKnot({ id: "M3", title: "Other2" });
    // Edge between M2 and M3 that also shows for M1 if no filter applied
    store.edges.push({ src: "M2", kind: "blocked_by", dst: "M3" });

    // Mock listEdges for M1 to return the M2->M3 edge
    mockListEdges.mockImplementationOnce(async () => ({
      ok: true as const,
      data: [{ src: "M2", kind: "blocked_by", dst: "M3" }],
    }));

    const result = await backend.listDependencies("M1");
    expect(result.ok).toBe(true);
    // The M2->M3 blocked_by edge should be skipped because M1 is neither src nor dst
    expect(result.data?.length).toBe(0);
  });
});

describe("KnotsBackend coverage: buildTakePrompt parent/scene mode", () => {
  it("returns parent prompt with child listing when isParent + childBeatIds", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PARENT-1", title: "Epic task", description: "Big task" });
    insertKnot({ id: "CHILD-A", title: "Child A" });
    insertKnot({ id: "CHILD-B", title: "Child B" });

    const result = await backend.buildTakePrompt("PARENT-1", {
      isParent: true,
      childBeatIds: ["CHILD-A", "CHILD-B"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(false);
    expect(result.data?.prompt).toContain("Parent beat ID: PARENT-1");
    expect(result.data?.prompt).toContain("CHILD-A");
    expect(result.data?.prompt).toContain("CHILD-B");
    expect(result.data?.prompt).toContain("KNOTS CLAIM MODE");
    expect(result.data?.prompt).toContain("Open child beat IDs:");
    // Should NOT have called claimKnot
    expect(mockClaimKnot).not.toHaveBeenCalled();
  });

  it("includes title and description in parent prompt", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "PARENT-2",
      title: "My Epic",
      description: "Detailed desc",
    });

    const result = await backend.buildTakePrompt("PARENT-2", {
      isParent: true,
      childBeatIds: ["C-1"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Title: My Epic");
    expect(result.data?.prompt).toContain("Description: Detailed desc");
  });

  it("uses body when description is absent for parent prompt", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "PARENT-3",
      title: "Body Epic",
      description: null,
      body: "Body text here",
    });

    const result = await backend.buildTakePrompt("PARENT-3", {
      isParent: true,
      childBeatIds: ["C-2"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.prompt).toContain("Description: Body text here");
  });

  it("returns error when parent knot does not exist", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.buildTakePrompt("MISSING", {
      isParent: true,
      childBeatIds: ["C-3"],
    });

    expect(result.ok).toBe(false);
  });

  it("falls through to single-beat claim when isParent but empty childBeatIds", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SOLO-1", title: "Solo" });

    const result = await backend.buildTakePrompt("SOLO-1", {
      isParent: true,
      childBeatIds: [],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(true);
    expect(mockClaimKnot).toHaveBeenCalled();
  });

  it("falls through to single-beat claim when isParent is false", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SOLO-2", title: "Solo 2" });

    const result = await backend.buildTakePrompt("SOLO-2", {
      isParent: false,
      childBeatIds: ["unused"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(true);
  });

  it("falls back to skillPrompt when claim fails", async () => {
    const backend = new KnotsBackend("/repo");
    mockClaimKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "Ready For Shipment has no skill",
    });

    insertKnot({ id: "FB-1", title: "Fallback Beat", state: "ready_for_shipment" });
    const result = await backend.buildTakePrompt("FB-1");

    expect(result.ok).toBe(true);
    expect(result.data?.claimed).toBe(false);
    expect(result.data?.prompt).toContain("Fallback Beat");
    expect(result.data?.prompt).toContain("Skill prompt placeholder");
  });

  it("returns original claim error when fallback skillPrompt also fails", async () => {
    const backend = new KnotsBackend("/repo");
    mockClaimKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "locked by another agent",
    });
    mockSkillPrompt.mockResolvedValueOnce({
      ok: false as const,
      error: "unknown skill",
    });

    insertKnot({ id: "LOCKED-1", title: "Locked" });
    const result = await backend.buildTakePrompt("LOCKED-1");

    expect(result.ok).toBe(false);
  });
});

describe("KnotsBackend coverage: search and query", () => {
  it("search matches on id, title, description, and notes", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "S1",
      title: "Alpha",
      description: "beta search target",
      notes: [{ content: "gamma note", username: "u", datetime: nowIso() }],
    });
    insertKnot({ id: "S2", title: "Unrelated" });

    const byDesc = await backend.search("beta");
    expect(byDesc.ok).toBe(true);
    expect(byDesc.data?.length).toBe(1);
    expect(byDesc.data?.[0]?.id).toBe("S1");

    const byNotes = await backend.search("gamma");
    expect(byNotes.ok).toBe(true);
    expect(byNotes.data?.length).toBe(1);
  });

  it("search applies filters to matched results", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SF1", title: "Match one", type: "task" });
    insertKnot({ id: "SF2", title: "Match two", type: "bug" });

    const result = await backend.search("Match", { type: "task" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("SF1");
  });

  it("query matches on expression fields", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "Q1", title: "Query target", type: "bug", priority: 1 });
    insertKnot({ id: "Q2", title: "Other", type: "task" });

    const byType = await backend.query("type:bug");
    expect(byType.ok).toBe(true);
    expect(byType.data?.length).toBe(1);
    expect(byType.data?.[0]?.id).toBe("Q1");
  });

  it("query supports multiple expression terms", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QM1", title: "Multi", type: "task", priority: 1 });
    insertKnot({ id: "QM2", title: "Other", type: "task", priority: 3 });

    const result = await backend.query("type:task priority:1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("QM1");
  });

  it("query returns error when buildBeats fails", async () => {
    mockListProfiles.mockResolvedValueOnce({
      ok: false as const,
      error: "profiles unavailable",
    } as never);

    const backend = new KnotsBackend("/repo");
    const result = await backend.query("type:task");
    expect(result.ok).toBe(false);
  });
});

describe("KnotsBackend coverage: listReady with blocking edges", () => {
  it("excludes blocked knots from listReady", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "R1", title: "Ready", state: "ready_for_implementation" });
    insertKnot({ id: "R2", title: "Blocked", state: "ready_for_implementation" });
    insertKnot({ id: "R3", title: "Blocker", state: "implementation" });
    store.edges.push({ src: "R2", kind: "blocked_by", dst: "R3" });

    // First call buildBeats to populate caches
    const listed = await backend.list();
    expect(listed.ok).toBe(true);

    const ready = await backend.listReady();
    expect(ready.ok).toBe(true);
    const readyIds = ready.data?.map((b) => b.id);
    expect(readyIds).toContain("R1");
    expect(readyIds).not.toContain("R2");
  });
});

describe("KnotsBackend coverage: update with parent manipulation", () => {
  it("replaces existing parent with new parent", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "UP1", title: "Old Parent" });
    insertKnot({ id: "UP2", title: "New Parent" });
    insertKnot({ id: "UC1", title: "Child" });
    store.edges.push({ src: "UP1", kind: "parent_of", dst: "UC1" });

    const result = await backend.update("UC1", { parent: "UP2" });
    expect(result.ok).toBe(true);

    // Should have removed old parent edge and added new one
    expect(mockRemoveEdge).toHaveBeenCalledWith("UP1", "parent_of", "UC1", "/repo");
    expect(mockAddEdge).toHaveBeenCalledWith("UP2", "parent_of", "UC1", "/repo");
  });

  it("removes parent when parent is empty string", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "RP1", title: "Parent" });
    insertKnot({ id: "RC1", title: "Child" });
    store.edges.push({ src: "RP1", kind: "parent_of", dst: "RC1" });

    const result = await backend.update("RC1", { parent: "" });
    expect(result.ok).toBe(true);
    expect(mockRemoveEdge).toHaveBeenCalledWith("RP1", "parent_of", "RC1", "/repo");
  });

  it("skips removing when new parent is same as existing", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "SP1", title: "Same Parent" });
    insertKnot({ id: "SC1", title: "Child" });
    store.edges.push({ src: "SP1", kind: "parent_of", dst: "SC1" });

    const result = await backend.update("SC1", { parent: "SP1" });
    expect(result.ok).toBe(true);
    // Should NOT remove the existing parent since it is the same
    expect(mockRemoveEdge).not.toHaveBeenCalled();
    // Should NOT add since already exists
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when trying to change profileId", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PID1", title: "Test" });

    const result = await backend.update("PID1", { profileId: "new-profile" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("profileId");
  });

  it("passes acceptance criteria as a note", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "AC1", title: "Accept test" });

    const result = await backend.update("AC1", {
      acceptance: "Must pass all tests",
    });
    expect(result.ok).toBe(true);

    const calls = mockUpdateKnot.mock.calls;
    const acceptanceCall = calls.find(
      (c) =>
        typeof c[1].addNote === "string" &&
        c[1].addNote.includes("Acceptance Criteria"),
    );
    expect(acceptanceCall).toBeDefined();
  });
});

describe("KnotsBackend coverage: removeDependency", () => {
  it("removes a blocked_by edge", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "RD1", title: "Blocker" });
    insertKnot({ id: "RD2", title: "Blocked" });
    store.edges.push({ src: "RD2", kind: "blocked_by", dst: "RD1" });

    const result = await backend.removeDependency("RD1", "RD2");
    expect(result.ok).toBe(true);
    expect(mockRemoveEdge).toHaveBeenCalledWith("RD2", "blocked_by", "RD1", "/repo");
  });

  it("returns error when edge does not exist", async () => {
    const backend = new KnotsBackend("/repo");
    const result = await backend.removeDependency("X1", "X2");
    expect(result.ok).toBe(false);
  });
});

describe("KnotsBackend coverage: knot with notes and metadata", () => {
  it("stringifies notes with datetime prefix", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "N1",
      title: "With notes",
      notes: [
        { content: "First note", username: "alice", datetime: "2026-01-01" },
        { content: "Second note", username: "bob", datetime: "" },
      ],
    });

    const result = await backend.get("N1");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toContain("[2026-01-01] alice: First note");
    expect(result.data?.notes).toContain("bob: Second note");
  });

  it("returns undefined notes when notes array is empty", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "N2", title: "No notes", notes: [] });

    const result = await backend.get("N2");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toBeUndefined();
  });

  it("handles notes with invalid entries", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "N3",
      title: "Bad notes",
      notes: [
        null as unknown as Record<string, unknown>,
        { content: "", username: "alice" },
        { content: "Valid", username: "bob", datetime: "2026-01-01" },
      ],
    });

    const result = await backend.get("N3");
    expect(result.ok).toBe(true);
    expect(result.data?.notes).toContain("bob: Valid");
  });
});

describe("KnotsBackend coverage: create with extra fields", () => {
  it("creates with priority, type, labels, notes, acceptance, and parent", async () => {
    const backend = new KnotsBackend("/repo");
    // We need a second knot for the parent edge
    insertKnot({ id: "CPARENT", title: "Parent" });

    const result = await backend.create({
      title: "Full create",
      type: "bug",
      priority: 1,
      labels: ["urgent", "frontend"],
      notes: "Implementation note",
      acceptance: "All tests pass",
      parent: "CPARENT",
    });

    expect(result.ok).toBe(true);
    // updateKnot should have been called for patch and acceptance
    const updateCalls = mockUpdateKnot.mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    // addEdge should have been called for parent
    expect(mockAddEdge).toHaveBeenCalled();
  });

  it("returns error when profiles are empty", async () => {
    mockListProfiles.mockResolvedValueOnce({
      ok: true as const,
      data: [],
    });

    const backend = new KnotsBackend("/repo");
    const result = await backend.create({
      title: "No profiles",
      type: "task",
      priority: 2,
      labels: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});

describe("KnotsBackend coverage: applyFilters edge cases", () => {
  it("filters by queued state", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "AF1", title: "Queued", state: "ready_for_planning" });
    // transition:verification keeps the active state from being rolled back
    insertKnot({ id: "AF2", title: "Active", state: "planning", tags: ["transition:verification"] });

    const result = await backend.list({ state: "queued" });
    expect(result.ok).toBe(true);
    expect(result.data?.every((b) => b.id === "AF1")).toBe(true);
  });

  it("filters by in_action state", async () => {
    const backend = new KnotsBackend("/repo");
    // transition:verification keeps the active state from being rolled back
    insertKnot({ id: "FA1", title: "Active", state: "implementation", tags: ["transition:verification"] });
    insertKnot({ id: "FA2", title: "Queued", state: "ready_for_implementation" });

    const result = await backend.list({ state: "in_action" });
    expect(result.ok).toBe(true);
    expect(result.data?.every((b) => b.id === "FA1")).toBe(true);
  });

  it("filters by exact state", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "ES1", title: "Shipped", state: "shipped" });
    insertKnot({ id: "ES2", title: "Planning", state: "planning" });

    const result = await backend.list({ state: "shipped" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("ES1");
  });

  it("filters by label", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "LB1", title: "Tagged", tags: ["urgent"] });
    insertKnot({ id: "LB2", title: "Not tagged" });

    const result = await backend.list({ label: "urgent" });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("LB1");
  });

  it("filters by priority", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PR1", title: "High", priority: 1 });
    insertKnot({ id: "PR2", title: "Low", priority: 3 });

    const result = await backend.list({ priority: 1 });
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data?.[0]?.id).toBe("PR1");
  });
});

describe("KnotsBackend coverage: query matchExpression fields", () => {
  it("matches on workflow/workflowid", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QW1", title: "W1", profile_id: "autopilot" });

    const result = await backend.query("workflowid:autopilot");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("matches on profile/profileid", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QP1", title: "P1", profile_id: "autopilot" });

    const result = await backend.query("profileid:autopilot");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("matches on id field", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QID1", title: "ID match" });

    const result = await backend.query("id:QID1");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("matches on label", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QL1", title: "Labeled", tags: ["bugfix"] });

    const result = await backend.query("label:bugfix");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });

  it("ignores unknown field in expression", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QU1", title: "Unknown field" });

    const result = await backend.query("unknown:value");
    expect(result.ok).toBe(true);
    // Unknown fields should be treated as always matching
    expect(result.data?.length).toBe(1);
  });

  it("ignores terms without colon separator", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "QNC1", title: "No colon" });

    const result = await backend.query("nocolon");
    expect(result.ok).toBe(true);
    expect(result.data?.length).toBe(1);
  });
});

describe("KnotsBackend coverage: toBeat edge cases", () => {
  it("uses body when description is missing", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "BD1",
      title: "Body only",
      description: null,
      body: "The body text",
    });

    const result = await backend.get("BD1");
    expect(result.ok).toBe(true);
    expect(result.data?.description).toBe("The body text");
  });

  it("normalizes invalid priority to 2", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NP1", title: "Bad prio", priority: 99 });

    const result = await backend.get("NP1");
    expect(result.ok).toBe(true);
    expect(result.data?.priority).toBe(2);
  });

  it("normalizes null priority to 2", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NP2", title: "Null prio", priority: null });

    const result = await backend.get("NP2");
    expect(result.ok).toBe(true);
    expect(result.data?.priority).toBe(2);
  });

  it("preserves valid priorities 0-4", async () => {
    const backend = new KnotsBackend("/repo");
    for (const p of [0, 1, 2, 3, 4]) {
      insertKnot({ id: `VP${p}`, title: `Prio ${p}`, priority: p });
    }

    for (const p of [0, 1, 2, 3, 4]) {
      const result = await backend.get(`VP${p}`);
      expect(result.ok).toBe(true);
      expect(result.data?.priority).toBe(p);
    }
  });

  it("sets closed timestamp for terminal states", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "TS1", title: "Shipped", state: "shipped" });

    const result = await backend.get("TS1");
    expect(result.ok).toBe(true);
    expect(result.data?.closed).toBeDefined();
  });

  it("filters out invalid tags", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "FT1",
      title: "Tags",
      tags: ["valid", "", "  ", "also-valid"],
    });

    const result = await backend.get("FT1");
    expect(result.ok).toBe(true);
    expect(result.data?.labels).toContain("valid");
    expect(result.data?.labels).toContain("also-valid");
    expect(result.data?.labels).not.toContain("");
  });

  it("includes knotsHandoffCapsules and knotsNotes in metadata", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({
      id: "MD1",
      title: "Metadata",
      notes: [{ content: "note1", username: "u", datetime: "" }],
      handoff_capsules: [{ content: "capsule1" }],
    });

    const result = await backend.get("MD1");
    expect(result.ok).toBe(true);
    const meta = result.data?.metadata as Record<string, unknown>;
    expect(meta?.knotsHandoffCapsules).toEqual([{ content: "capsule1" }]);
    expect(Array.isArray(meta?.knotsNotes)).toBe(true);
  });
});

describe("KnotsBackend coverage: workflow cache", () => {
  it("caches workflow descriptors between calls", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "WC1", title: "Test" });

    await backend.list();
    await backend.list();

    // listProfiles should only be called once due to caching
    expect(mockListProfiles).toHaveBeenCalledTimes(1);
  });
});

describe("KnotsBackend coverage: update with state change", () => {
  it("normalizes state via workflow when updating", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "US1", title: "State update" });

    const result = await backend.update("US1", { state: "implementation" });
    expect(result.ok).toBe(true);

    const lastUpdateCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateCall?.[1]?.status).toBeDefined();
  });

  it("returns error when get fails during update", async () => {
    const backend = new KnotsBackend("/repo");
    // Do not insert a knot so get() fails
    const result = await backend.update("MISSING-1", { title: "nope" });
    expect(result.ok).toBe(false);
  });

  it("updates title, description, priority, type together", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "MU1", title: "Multi update" });

    const result = await backend.update("MU1", {
      title: "New title",
      description: "New desc",
      priority: 1,
      type: "bug",
    });
    expect(result.ok).toBe(true);

    const lastUpdateCall = mockUpdateKnot.mock.calls.at(-1);
    expect(lastUpdateCall?.[1]).toMatchObject({
      title: "New title",
      description: "New desc",
      priority: 1,
      type: "bug",
    });
  });

  it("adds and removes labels in update", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "LU1", title: "Label update", tags: ["old-tag"] });

    const result = await backend.update("LU1", {
      labels: ["new-tag"],
      removeLabels: ["old-tag"],
    });
    expect(result.ok).toBe(true);

    const calls = mockUpdateKnot.mock.calls;
    const patchCall = calls.find(
      (c) => Array.isArray(c[1]?.addTags) || Array.isArray(c[1]?.removeTags),
    );
    expect(patchCall?.[1]?.addTags).toEqual(["new-tag"]);
    expect(patchCall?.[1]?.removeTags).toEqual(["old-tag"]);
  });

  it("adds notes in update", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NU1", title: "Note update" });

    const result = await backend.update("NU1", { notes: "A new note" });
    expect(result.ok).toBe(true);

    const calls = mockUpdateKnot.mock.calls;
    const noteCall = calls.find((c) => c[1]?.addNote === "A new note");
    expect(noteCall).toBeDefined();
  });

  it("skips updateKnot when no patch fields set", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "NP1", title: "No patch" });

    // Update with empty input (nothing to patch)
    const result = await backend.update("NP1", {});
    expect(result.ok).toBe(true);

    // updateKnot should not have been called for the main patch
    // (it may still be called 0 times since there is nothing to update)
    const directPatchCalls = mockUpdateKnot.mock.calls.filter(
      (c) =>
        c[0] === "NP1" &&
        (c[1]?.title !== undefined ||
          c[1]?.description !== undefined ||
          c[1]?.priority !== undefined ||
          c[1]?.status !== undefined ||
          c[1]?.type !== undefined ||
          c[1]?.addTags !== undefined ||
          c[1]?.removeTags !== undefined ||
          c[1]?.addNote !== undefined),
    );
    expect(directPatchCalls.length).toBe(0);
  });
});

describe("KnotsBackend coverage: update parent error paths", () => {
  it("propagates error when listing incoming edges fails", async () => {
    const backend = new KnotsBackend("/repo");
    insertKnot({ id: "PE1", title: "Parent error" });

    // Make listEdges fail for the "incoming" call during update.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListEdges as any).mockImplementation(
      async (
        _id: string,
        direction?: "incoming" | "outgoing" | "both",
        _repoPath?: string,
      ) => {
        if (direction === "incoming") {
          return { ok: false as const, error: "edge lookup failed" };
        }
        return { ok: true as const, data: [] };
      },
    );

    const result = await backend.update("PE1", { parent: "NEW-PARENT" });
    expect(result.ok).toBe(false);

    // Reset the mock back to the default implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListEdges as any).mockImplementation(
      async (
        id: string,
        direction?: "incoming" | "outgoing" | "both",
        _repoPath?: string,
      ) => {
        const dir = direction ?? "both";
        const edges = store.edges.filter((edge: MockEdge) => {
          if (dir === "incoming") return edge.dst === id;
          if (dir === "outgoing") return edge.src === id;
          return edge.src === id || edge.dst === id;
        });
        return { ok: true as const, data: edges };
      },
    );
  });
});

describe("KnotsBackend coverage: classifyKnotsError variations", () => {
  it("classifies rate limit error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "rate limit exceeded",
    });

    const result = await backend.get("RL1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("RATE_LIMITED");
  });

  it("classifies unavailable error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "service unavailable",
    });

    const result = await backend.get("UA1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNAVAILABLE");
  });

  it("classifies permission denied error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "permission denied for resource",
    });

    const result = await backend.get("PD1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PERMISSION_DENIED");
  });

  it("classifies locked/busy error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "database is busy",
    });

    const result = await backend.get("LK1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LOCKED");
  });

  it("classifies timeout error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "operation timed out",
    });

    const result = await backend.get("TO1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TIMEOUT");
  });

  it("classifies already exists error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "resource already exists",
    });

    const result = await backend.get("AE1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ALREADY_EXISTS");
  });

  it("classifies invalid input error", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "invalid parameter value",
    });

    const result = await backend.get("II1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("classifies unknown error as INTERNAL", async () => {
    const backend = new KnotsBackend("/repo");

    mockShowKnot.mockResolvedValueOnce({
      ok: false as const,
      error: "something completely unexpected",
    });

    const result = await backend.get("UN1");
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INTERNAL");
  });
});
