/**
 * Shared mock store and mock implementations for
 * knots-backend split test files.
 */
import { vi } from "vitest";

export interface MockKnot {
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

export const mockListKnots = vi.fn(async () => {
  return {
    ok: true as const,
    data: Array.from(store.knots.values()),
  };
});

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

export const mockRehydrateKnot = vi.fn(async (id: string) => {
  const knot = store.knots.get(id);
  if (!knot) {
    return {
      ok: false as const,
      error: `knot '${id}' not found in cold storage`,
    };
  }
  return { ok: true as const, data: knot };
});

export const mockNewKnot = vi.fn(
  async (
    title: string,
    options?: {
      body?: string;
      description?: string;
      state?: string;
      profile?: string;
      workflow?: string;
    },
  ) => {
    const id = nextId();
    const now = nowIso();
    const profileId =
      options?.profile ?? options?.workflow ?? "autopilot";
    const description =
      options?.description ?? options?.body ?? null;
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

export const mockListWorkflows = vi.fn(async () => {
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
        states: [
          "work_item",
          "implementing",
          "reviewing",
          "shipped",
        ],
        terminal_states: ["shipped"],
      },
    ],
  };
});

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

export const mockListProfiles = vi.fn(async () => {
  return {
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
      {
        id: "semiauto",
        description: "Human-gated reviews profile",
        initial_state: "ready_for_planning",
        states: PROFILE_STATES,
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

export const mockUpdateKnot = vi.fn(
  async (id: string, input: Record<string, unknown>) => {
    const knot = store.knots.get(id);
    if (!knot) {
      return {
        ok: false as const,
        error: `knot '${id}' not found in local cache`,
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
    const removeTags = Array.isArray(input.removeTags)
      ? input.removeTags.filter(
          (v): v is string => typeof v === "string",
        )
      : [];

    for (const tag of addTags) {
      if (!knot.tags.includes(tag)) knot.tags.push(tag);
    }
    if (removeTags.length > 0) {
      knot.tags = knot.tags.filter(
        (tag) => !removeTags.includes(tag),
      );
    }

    if (typeof input.addNote === "string") {
      knot.notes.push({
        content: input.addNote,
        username: input.noteUsername ?? "unknown",
        datetime: input.noteDatetime ?? nowIso(),
        agentname: "unknown",
        model: "unknown",
        version: "unknown",
      });
    }

    if (typeof input.addHandoffCapsule === "string") {
      knot.handoff_capsules.push({
        content: input.addHandoffCapsule,
        username: input.handoffUsername ?? "unknown",
        datetime: input.handoffDatetime ?? nowIso(),
        agentname: "unknown",
        model: "unknown",
        version: "unknown",
      });
    }

    knot.updated_at = nowIso();
    return { ok: true as const };
  },
);

export const mockListEdges = vi.fn(
  async (
    id: string,
    direction: "incoming" | "outgoing" | "both" = "both",
  ) => {
    const edges = store.edges.filter((edge) => {
      if (direction === "incoming") return edge.dst === id;
      if (direction === "outgoing") return edge.src === id;
      return edge.src === id || edge.dst === id;
    });
    return { ok: true as const, data: edges };
  },
);

export const mockAddEdge = vi.fn(
  async (src: string, kind: string, dst: string) => {
    if (!store.knots.has(src) || !store.knots.has(dst)) {
      return {
        ok: false as const,
        error: `knot '${src}' or '${dst}' not found`,
      };
    }

    const exists = store.edges.some(
      (edge) =>
        edge.src === src &&
        edge.kind === kind &&
        edge.dst === dst,
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
      (edge) =>
        edge.src === src &&
        edge.kind === kind &&
        edge.dst === dst,
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
      profile_id: knot.profile_id ?? "autopilot",
      type: knot.type,
      priority: knot.priority,
      prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
    },
  };
});

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
      profile_id: knot.profile_id ?? "autopilot",
      type: knot.type,
      priority: knot.priority,
      prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
    },
  };
});

type CastFn = (...x: unknown[]) => unknown;

export function buildMockModule() {
  return {
    listProfiles: (...a: unknown[]) =>
      (mockListProfiles as CastFn)(...a),
    listWorkflows: (...a: unknown[]) =>
      (mockListWorkflows as CastFn)(...a),
    listKnots: (...a: unknown[]) =>
      (mockListKnots as CastFn)(...a),
    showKnot: (...a: unknown[]) =>
      (mockShowKnot as CastFn)(...a),
    rehydrateKnot: (...a: unknown[]) =>
      (mockRehydrateKnot as CastFn)(...a),
    newKnot: (...a: unknown[]) =>
      (mockNewKnot as CastFn)(...a),
    updateKnot: (...a: unknown[]) =>
      (mockUpdateKnot as CastFn)(...a),
    listEdges: (...a: unknown[]) =>
      (mockListEdges as CastFn)(...a),
    addEdge: (...a: unknown[]) =>
      (mockAddEdge as CastFn)(...a),
    removeEdge: (...a: unknown[]) =>
      (mockRemoveEdge as CastFn)(...a),
    claimKnot: (...a: unknown[]) =>
      (mockClaimKnot as CastFn)(...a),
    pollKnot: (...a: unknown[]) =>
      (mockPollKnot as CastFn)(...a),
    skillPrompt: vi.fn(async () => ({
      ok: true as const,
      data: "Skill prompt placeholder",
    })),
    nextKnot: vi.fn(async () => ({
      ok: true as const,
    })),
  };
}

export function seedKnot(
  id: string,
  state: string,
  overrides?: Partial<MockKnot>,
) {
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
