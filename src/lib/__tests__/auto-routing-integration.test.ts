import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as memoryManagerDetection from "@/lib/memory-manager-detection";

// ── Mock Beads/BD CLI backend ────────────────────────────────────

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

// ── Mock Knots backend ───────────────────────────────────────────

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

// ── Imports after mocks ──────────────────────────────────────────

import { AutoRoutingBackend } from "@/lib/backend-factory";
import { KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";

// ── Helpers ──────────────────────────────────────────────────────

function makeRepo(markerDirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "foolery-auto-integration-"));
  for (const marker of markerDirs) {
    mkdirSync(join(dir, marker), { recursive: true });
  }
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test group 1: Per-repo capability resolution ─────────────────

describe("AutoRoutingBackend.capabilitiesForRepo", () => {
  it("returns KNOTS_CAPABILITIES for a .knots repo", () => {
    const repo = makeRepo([".knots"]);
    const backend = new AutoRoutingBackend("cli");
    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(KNOTS_CAPABILITIES);
  });

  it("returns FULL_CAPABILITIES for a .beads repo", () => {
    const repo = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");
    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(FULL_CAPABILITIES);
  });

  it("returns fallback capabilities when repoPath is undefined", () => {
    const backend = new AutoRoutingBackend("cli");
    const caps = backend.capabilitiesForRepo(undefined);
    // Fallback is "cli" which uses FULL_CAPABILITIES
    expect(caps).toEqual(FULL_CAPABILITIES);
  });

  it("returns fallback capabilities for an unmarked repo", () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");
    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(FULL_CAPABILITIES);
  });
});

// ── Test group 2: Mixed tracker operation routing ────────────────

describe("Mixed tracker operation routing", () => {
  it("routes to Knots when both .knots and .beads markers exist", async () => {
    const repo = makeRepo([".knots", ".beads"]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.list(undefined, repo);
    expect(result.ok).toBe(true);
    expect(result.data?.[0].id).toBe("K-0001");
    expect(mockListKnots).toHaveBeenCalled();
    expect(mockListBeads).not.toHaveBeenCalled();
  });

  it("routes different repos to different backends in the same instance", async () => {
    const knotsRepo = makeRepo([".knots"]);
    const beadsRepo = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    const knotsResult = await backend.list(undefined, knotsRepo);
    expect(knotsResult.ok).toBe(true);
    expect(knotsResult.data?.[0].id).toBe("K-0001");
    expect(mockListKnots).toHaveBeenCalledTimes(1);

    const beadsResult = await backend.list(undefined, beadsRepo);
    expect(beadsResult.ok).toBe(true);
    expect(beadsResult.data?.[0].id).toBe("bd-1");
    expect(mockListBeads).toHaveBeenCalledTimes(1);
  });

  it("returns Knots-shaped data for .knots and Beads-shaped data for .beads", async () => {
    const knotsRepo = makeRepo([".knots"]);
    const beadsRepo = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    const knotsResult = await backend.list(undefined, knotsRepo);
    expect(knotsResult.ok).toBe(true);
    const knotsItem = knotsResult.data?.[0];
    expect(knotsItem).toBeDefined();
    expect(knotsItem!.id).toBe("K-0001");
    expect(knotsItem!.title).toBe("Knots item");

    const beadsResult = await backend.list(undefined, beadsRepo);
    expect(beadsResult.ok).toBe(true);
    const beadsItem = beadsResult.data?.[0];
    expect(beadsItem).toBeDefined();
    expect(beadsItem!.id).toBe("bd-1");
    expect(beadsItem!.title).toBe("Beads item");
  });
});

// ── Test group 3: Cache behavior with mixed repos ────────────────

describe("Cache behavior with mixed repos", () => {
  it("caches per-repo so routing repo A to Knots does not affect repo B", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repoA = makeRepo([".knots"]);
    const repoB = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    // First call for each repo triggers detection
    await backend.list(undefined, repoA);
    expect(spy).toHaveBeenCalledTimes(1);

    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(2);

    // Repeated calls use cache -- no extra detection
    await backend.list(undefined, repoA);
    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(2);

    // Verify correct routing persists from cache
    expect(mockListKnots).toHaveBeenCalledTimes(2);
    expect(mockListBeads).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it("clearRepoCache(repoPath) only clears the specified repo", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repoA = makeRepo([".knots"]);
    const repoB = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    // Populate cache for both repos
    await backend.list(undefined, repoA);
    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(2);

    // Clear only repoA
    backend.clearRepoCache(repoA);

    // repoA should re-detect, repoB should still be cached
    await backend.list(undefined, repoA);
    expect(spy).toHaveBeenCalledTimes(3);

    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(3); // still cached

    spy.mockRestore();
  });

  it("clearRepoCache() with no args clears all cached repos", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repoA = makeRepo([".knots"]);
    const repoB = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    // Populate cache for both repos
    await backend.list(undefined, repoA);
    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(2);

    // Clear all
    backend.clearRepoCache();

    // Both repos should re-detect
    await backend.list(undefined, repoA);
    expect(spy).toHaveBeenCalledTimes(3);

    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(4);

    spy.mockRestore();
  });
});
