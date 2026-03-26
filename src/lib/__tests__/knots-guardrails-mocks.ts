/**
 * Shared mock store and mock implementations for
 * knots-guardrails split test files.
 */
import { vi } from "vitest";

export interface MockKnot {
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

export interface MockEdge {
  src: string;
  kind: string;
  dst: string;
}

export const store = {
  seq: 0,
  knots: new Map<string, MockKnot>(),
  edges: [] as MockEdge[],
};

export function nowIso(): string {
  return new Date().toISOString();
}

function nextId(): string {
  store.seq += 1;
  return `K-${String(store.seq).padStart(4, "0")}`;
}

export function resetStore(): void {
  store.seq = 0;
  store.knots.clear();
  store.edges = [];
}

export const AUTOPILOT_STATES = [
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

export const mockListProfiles = vi.fn(async () => ({
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
    {
      id: "semiauto",
      description: "Human-gated reviews profile",
      initial_state: "ready_for_planning",
      states: AUTOPILOT_STATES,
      terminal_states: ["shipped"],
      owners: {
        planning: { kind: "agent" as const },
        plan_review: { kind: "human" as const },
        implementation: { kind: "agent" as const },
        implementation_review: { kind: "human" as const },
        shipment: { kind: "agent" as const },
        shipment_review: { kind: "agent" as const },
      },
    },
  ],
}));

export const mockListKnots = vi.fn(async () => ({
  ok: true as const,
  data: Array.from(store.knots.values()),
}));

export const mockShowKnot = vi.fn(async (id: string) => {
  const knot = store.knots.get(id);
  if (!knot) {
    return {
      ok: false as const,
      error: `knot '${id}' not found in local cache`,
    };
  }
  return { ok: true as const, data: knot };
});

export const mockNewKnot = vi.fn(
  async (
    title: string,
    options?: {
      description?: string;
      state?: string;
      profile?: string;
    },
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

export const mockUpdateKnot = vi.fn(
  async (id: string, input: Record<string, unknown>) => {
    const knot = store.knots.get(id);
    if (!knot) {
      return {
        ok: false as const,
        error: `knot '${id}' not found`,
      };
    }
    if (typeof input.title === "string") knot.title = input.title;
    if (typeof input.description === "string") {
      knot.description = input.description;
      knot.body = input.description;
    }
    if (typeof input.priority === "number") {
      knot.priority = input.priority;
    }
    if (typeof input.status === "string") knot.state = input.status;
    if (typeof input.type === "string") knot.type = input.type;
    const addTags = Array.isArray(input.addTags)
      ? input.addTags.filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    for (const tag of addTags) {
      if (!knot.tags.includes(tag)) knot.tags.push(tag);
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

export const mockSetKnotProfile = vi.fn(
  async (
    id: string,
    profile: string,
    _repoPath?: string,
    options?: { state?: string; ifMatch?: string },
  ) => {
    const knot = store.knots.get(id);
    if (!knot) {
      return {
        ok: false as const,
        error: `knot '${id}' not found`,
      };
    }
    knot.profile_id = profile;
    knot.workflow_id = profile;
    if (typeof options?.state === "string") {
      knot.state = options.state;
    }
    knot.updated_at = nowIso();
    return { ok: true as const };
  },
);

export const mockListEdges = vi.fn(async (id: string) => {
  const edges = store.edges.filter(
    (edge) => edge.src === id || edge.dst === id,
  );
  return { ok: true as const, data: edges };
});

export const mockAddEdge = vi.fn(
  async (src: string, kind: string, dst: string) => {
    const exists = store.edges.some(
      (e) =>
        e.src === src && e.kind === kind && e.dst === dst,
    );
    if (!exists) {
      store.edges.push({ src, kind, dst });
    }
    return { ok: true as const };
  },
);

export const mockRemoveEdge = vi.fn(
  async (src: string, kind: string, dst: string) => {
    const idx = store.edges.findIndex(
      (e) =>
        e.src === src && e.kind === kind && e.dst === dst,
    );
    if (idx === -1) {
      return { ok: false as const, error: "edge not found" };
    }
    store.edges.splice(idx, 1);
    return { ok: true as const };
  },
);

export const mockClaimKnot = vi.fn(async (id: string) => {
  const knot = store.knots.get(id);
  if (!knot) {
    return {
      ok: false as const,
      error: `knot '${id}' not found`,
    };
  }
  return {
    ok: true as const,
    data: {
      id: knot.id,
      title: knot.title,
      state: knot.state,
      profile_id: "autopilot",
      prompt: `# ${knot.title}`,
    },
  };
});

export const mockPollKnot = vi.fn(async () => {
  const claimable = Array.from(store.knots.values())
    .filter((k) => k.state.startsWith("ready_for_"))
    .sort(
      (a, b) => (a.priority ?? 99) - (b.priority ?? 99),
    );
  if (claimable.length === 0) {
    return {
      ok: false as const,
      error: "no claimable knots found",
    };
  }
  const knot = claimable[0]!;
  return {
    ok: true as const,
    data: {
      id: knot.id,
      title: knot.title,
      state: knot.state,
      profile_id: "autopilot",
      prompt: `# ${knot.title}`,
    },
  };
});

export function buildMockModule() {
  return {
    listProfiles: () => mockListProfiles(),
    listWorkflows: () =>
      Promise.resolve({ ok: true, data: [] }),
    listKnots: () => mockListKnots(),
    showKnot: (id: string) => mockShowKnot(id),
    newKnot: (
      title: string,
      options?: Record<string, unknown>,
    ) =>
      mockNewKnot(
        title,
        options as Parameters<typeof mockNewKnot>[1],
      ),
    updateKnot: (
      id: string,
      input: Record<string, unknown>,
    ) => mockUpdateKnot(id, input),
    setKnotProfile: (
      id: string,
      profile: string,
      repoPath?: string,
      options?: { state?: string; ifMatch?: string },
    ) => mockSetKnotProfile(id, profile, repoPath, options),
    listEdges: (id: string) => mockListEdges(id),
    addEdge: (src: string, kind: string, dst: string) =>
      mockAddEdge(src, kind, dst),
    removeEdge: (src: string, kind: string, dst: string) =>
      mockRemoveEdge(src, kind, dst),
    claimKnot: (id: string) => mockClaimKnot(id),
    pollKnot: () => mockPollKnot(),
    skillPrompt: vi.fn(async () => ({
      ok: true as const,
      data: "Skill prompt placeholder",
    })),
    nextKnot: vi.fn(async () => ({
      ok: true as const,
    })),
  };
}
