import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as memoryManagerDetection from "@/lib/memory-manager-detection";

const mockListBeads = vi.fn(async () => ({
  ok: true as const,
  data: [
    {
      id: "bd-1",
      title: "Beads item",
      type: "task",
      status: "open",
      priority: 2,
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
    },
  ],
}));

vi.mock("@/lib/bd", () => ({
  listBeats: () => mockListBeads(),
  listBeads: () => mockListBeads(),
  readyBeats: () => mockListBeads(),
  readyBeads: () => mockListBeads(),
  searchBeats: () => mockListBeads(),
  searchBeads: () => mockListBeads(),
  queryBeats: () => mockListBeads(),
  queryBeads: () => mockListBeads(),
  showBeat: vi.fn(async () => ({ ok: false, error: "not found" })),
  showBead: vi.fn(async () => ({ ok: false, error: "not found" })),
  createBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  createBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  deleteBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  deleteBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  closeBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  closeBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  listDeps: vi.fn(async () => ({ ok: true, data: [] })),
  addDep: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  removeDep: vi.fn(async () => ({ ok: false, error: "not implemented" })),
}));

const mockListKnots = vi.fn(async () => ({
  ok: true as const,
  data: [
    {
      id: "K-0001",
      title: "Knots item",
      state: "work_item",
      updated_at: "2026-01-01T00:00:00Z",
      body: null,
      description: null,
      priority: null,
      type: null,
      tags: [],
      notes: [],
      handoff_capsules: [],
      workflow_id: "granular",
      workflow_etag: "etag",
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
}));

const mockListEdges = vi.fn(async () => ({ ok: true as const, data: [] }));
const mockListWorkflows = vi.fn(async () => ({
  ok: true as const,
  data: [
    {
      id: "granular",
      description: "Automated granular workflow",
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
}));

const mockListProfiles = vi.fn(async () => ({
  ok: true as const,
  data: [
    {
      id: "autopilot",
      description: "Fully agent-owned profile",
      initial_state: "ready_for_planning",
      states: [
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
      ],
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

vi.mock("@/lib/knots", () => ({
  listProfiles: () => mockListProfiles(),
  listWorkflows: () => mockListWorkflows(),
  listKnots: () => mockListKnots(),
  showKnot: vi.fn(async () => ({ ok: false, error: "not found" })),
  newKnot: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateKnot: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  listEdges: () => mockListEdges(),
  addEdge: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  removeEdge: vi.fn(async () => ({ ok: false, error: "not implemented" })),
}));

import { createBackend, AutoRoutingBackend } from "@/lib/backend-factory";

function makeRepo(markerDirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "foolery-auto-backend-"));
  for (const marker of markerDirs) {
    mkdirSync(join(dir, marker), { recursive: true });
  }
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBackend(auto)", () => {
  it("routes .beads repos to cli backend", async () => {
    const repo = makeRepo([".beads"]);
    const backend = createBackend("auto").port;

    const result = await backend.list(undefined, repo);
    expect(result.ok).toBe(true);
    expect(result.data?.[0].id).toBe("bd-1");
    expect(mockListBeads).toHaveBeenCalled();
  });

  it("routes .knots repos to knots backend", async () => {
    const repo = makeRepo([".knots"]);
    const backend = createBackend("auto").port;

    const result = await backend.list(undefined, repo);
    expect(result.ok).toBe(true);
    expect(result.data?.[0].id).toBe("K-0001");
    expect(mockListKnots).toHaveBeenCalled();
  });

  it("prefers knots when both markers exist", async () => {
    const repo = makeRepo([".beads", ".knots"]);
    const backend = createBackend("auto").port;

    const result = await backend.list(undefined, repo);
    expect(result.ok).toBe(true);
    expect(result.data?.[0].id).toBe("K-0001");
    expect(mockListKnots).toHaveBeenCalled();
  });

  it("falls back to cli when no marker exists", async () => {
    const repo = makeRepo([]);
    const backend = createBackend("auto").port;

    const result = await backend.list(undefined, repo);
    expect(result.ok).toBe(true);
    expect(result.data?.[0].id).toBe("bd-1");
    expect(mockListBeads).toHaveBeenCalled();
  });
});

describe("AutoRoutingBackend repo type caching", () => {
  it("caches detection so repeated calls skip filesystem checks", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repo = makeRepo([".knots"]);
    const backend = new AutoRoutingBackend("cli");

    await backend.list(undefined, repo);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second call should use cache -- no additional detection
    await backend.list(undefined, repo);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("re-detects after clearRepoCache()", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repo = makeRepo([".knots"]);
    const backend = new AutoRoutingBackend("cli");

    await backend.list(undefined, repo);
    expect(spy).toHaveBeenCalledTimes(1);

    backend.clearRepoCache();
    await backend.list(undefined, repo);
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it("detects each repo independently", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repoA = makeRepo([".knots"]);
    const repoB = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    const resultA = await backend.list(undefined, repoA);
    expect(resultA.ok).toBe(true);
    expect(resultA.data?.[0].id).toBe("K-0001");
    expect(spy).toHaveBeenCalledTimes(1);

    const resultB = await backend.list(undefined, repoB);
    expect(resultB.ok).toBe(true);
    expect(resultB.data?.[0].id).toBe("bd-1");
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });
});
