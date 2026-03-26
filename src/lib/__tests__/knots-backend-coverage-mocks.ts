/**
 * Shared mock store and mock implementations for
 * knots-backend-coverage split test files.
 */
import { vi } from "vitest";

// ── Mock store ──────────────────────────────────────────────

export interface MockKnot {
  id: string;
  title: string;
  aliases?: string[];
  state: string;
  profile_id?: string;
  workflow_id?: string;
  updated_at: string;
  body: string | null;
  description: string | null;
  acceptance?: string | null;
  priority: number | null;
  type: string | null;
  tags: string[];
  notes: Array<Record<string, unknown>>;
  handoff_capsules: Array<Record<string, unknown>>;
  steps?: Array<Record<string, unknown>>;
  invariants?: Array<{ kind: "Scope" | "State"; condition: string }>;
  workflow_etag: string;
  profile_etag?: string;
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

function parseInvariantToken(
  value: string,
): { kind: "Scope" | "State"; condition: string } | null {
  const [rawKind, ...rest] = value.split(":");
  const kind = rawKind?.trim();
  const condition = rest.join(":").trim();
  if (
    (kind === "Scope" || kind === "State") &&
    condition.length > 0
  ) {
    return { kind, condition };
  }
  return null;
}

function nextId(): string {
  store.seq += 1;
  return `KC-${String(store.seq).padStart(4, "0")}`;
}

export function resetStore(): void {
  store.seq = 0;
  store.knots.clear();
  store.edges = [];
}

// ── Mock implementations ────────────────────────────────────

export const mockListProfiles = vi.fn(async () => {
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
          shipment_review: { kind: "agent" as const },
        },
      },
    ],
  };
});

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

export const mockNewKnot = vi.fn(
  async (
    title: string,
    options?: {
      description?: string;
      acceptance?: string;
      state?: string;
      profile?: string;
    },
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
      acceptance: options?.acceptance ?? null,
      priority: null,
      type: null,
      tags: [],
      notes: [],
      handoff_capsules: [],
      invariants: undefined,
      workflow_etag: `${id}-etag`,
      created_at: now,
    });
    return { ok: true as const, data: { id } };
  },
);

type InvariantEntry = {
  kind: "Scope" | "State";
  condition: string;
};

function parseInvariantArray(
  raw: unknown,
): InvariantEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map(parseInvariantToken)
    .filter((inv): inv is InvariantEntry => inv !== null);
}

function applyInvariantMutations(
  knot: MockKnot,
  input: Record<string, unknown>,
): void {
  const addInvariants = parseInvariantArray(
    input.addInvariants,
  );
  const removeInvariants = parseInvariantArray(
    input.removeInvariants,
  );
  if (input.clearInvariants === true) {
    knot.invariants = undefined;
  }
  if (removeInvariants.length > 0) {
    const removeSet = new Set(
      removeInvariants.map(
        (inv) => `${inv.kind}:${inv.condition}`,
      ),
    );
    knot.invariants = (knot.invariants ?? []).filter(
      (inv) =>
        !removeSet.has(`${inv.kind}:${inv.condition}`),
    );
    if (knot.invariants.length === 0) {
      knot.invariants = undefined;
    }
  }
  if (addInvariants.length > 0) {
    const existing = new Set(
      (knot.invariants ?? []).map(
        (inv) => `${inv.kind}:${inv.condition}`,
      ),
    );
    const toAdd = addInvariants.filter(
      (inv) =>
        !existing.has(`${inv.kind}:${inv.condition}`),
    );
    knot.invariants = [...(knot.invariants ?? []), ...toAdd];
  }
}

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
    if ("acceptance" in input) {
      knot.acceptance =
        typeof input.acceptance === "string"
          ? input.acceptance
          : null;
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
        username: "test",
        datetime: nowIso(),
      });
    }

    applyInvariantMutations(knot, input);

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
        error: `knot '${id}' not found in local cache`,
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
    if (
      !store.edges.some(
        (edge) =>
          edge.src === src &&
          edge.kind === kind &&
          edge.dst === dst,
      )
    ) {
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

export const mockClaimKnot = vi.fn(async (id: string) => {
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
      prompt: `# ${knot.title}\n\n**ID**: ${knot.id}`,
    },
  };
});

type SkillPromptResult =
  | { ok: true; data: string }
  | { ok: false; error: string };

export const mockSkillPrompt = vi.fn(
  async (): Promise<SkillPromptResult> => {
    return { ok: true as const, data: "Skill prompt placeholder" };
  },
);

export const mockNextKnot = vi.fn(async () => {
  return { ok: true as const };
});

type CastFn = (...x: unknown[]) => unknown;

export function buildMockModule() {
  return {
    listProfiles: (...a: unknown[]) =>
      (mockListProfiles as CastFn)(...a),
    listWorkflows: vi.fn(async () => ({
      ok: true as const,
      data: [],
    })),
    listKnots: (...a: unknown[]) =>
      (mockListKnots as CastFn)(...a),
    showKnot: (...a: unknown[]) =>
      (mockShowKnot as CastFn)(...a),
    newKnot: (...a: unknown[]) =>
      (mockNewKnot as CastFn)(...a),
    updateKnot: (...a: unknown[]) =>
      (mockUpdateKnot as CastFn)(...a),
    setKnotProfile: (...a: unknown[]) =>
      (mockSetKnotProfile as CastFn)(...a),
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
    skillPrompt: (...a: unknown[]) =>
      (mockSkillPrompt as CastFn)(...a),
    nextKnot: (...a: unknown[]) =>
      (mockNextKnot as CastFn)(...a),
  };
}

// ── Helper ──────────────────────────────────────────────────

export function insertKnot(
  overrides: Partial<MockKnot> & { id: string },
): void {
  const now = nowIso();
  const knot: MockKnot = {
    id: overrides.id,
    title: overrides.title ?? "Untitled",
    aliases: overrides.aliases ?? [],
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
    steps: overrides.steps ?? [],
    invariants: overrides.invariants,
    workflow_etag: overrides.workflow_etag ?? "etag",
    profile_etag: overrides.profile_etag,
    created_at: overrides.created_at ?? now,
  };
  if ("acceptance" in overrides) {
    knot.acceptance = overrides.acceptance ?? null;
  }
  store.knots.set(overrides.id, knot);
}
