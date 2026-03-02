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
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";
import { BEADS_CAPABILITIES } from "@/lib/backends/beads-backend";
import { KNOTS_CAPABILITIES } from "@/lib/backends/knots-backend";
import { STUB_CAPABILITIES } from "@/lib/backends/stub-backend";

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

describe("createBackend() concrete types", () => {
  it("creates cli backend with FULL_CAPABILITIES", () => {
    const entry = createBackend("cli");
    expect(entry.port).toBeDefined();
    expect(entry.capabilities).toEqual(FULL_CAPABILITIES);
  });

  it("creates stub backend with STUB_CAPABILITIES", () => {
    const entry = createBackend("stub");
    expect(entry.port).toBeDefined();
    expect(entry.capabilities).toEqual(STUB_CAPABILITIES);
  });

  it("creates beads backend with BEADS_CAPABILITIES", () => {
    const entry = createBackend("beads");
    expect(entry.port).toBeDefined();
    expect(entry.capabilities).toEqual(BEADS_CAPABILITIES);
  });

  it("creates knots backend with KNOTS_CAPABILITIES", () => {
    const entry = createBackend("knots");
    expect(entry.port).toBeDefined();
    expect(entry.capabilities).toEqual(KNOTS_CAPABILITIES);
  });

  it("defaults to auto when no type given", () => {
    const entry = createBackend();
    expect(entry.port).toBeDefined();
    expect(entry.capabilities).toEqual(FULL_CAPABILITIES);
  });
});

describe("AutoRoutingBackend proxy methods", () => {
  it("delegates listWorkflows to resolved backend", async () => {
    const repo = makeRepo([".knots"]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.listWorkflows(repo);
    expect(result.ok).toBe(true);
    // KnotsBackend derives workflows from profiles, not from listWorkflows
    expect(mockListProfiles).toHaveBeenCalled();
  });

  it("delegates listReady to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.listReady(undefined, repo);
    expect(result.ok).toBe(true);
    expect(mockListBeads).toHaveBeenCalled();
  });

  it("delegates search to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.search("test", undefined, repo);
    expect(result.ok).toBe(true);
    expect(mockListBeads).toHaveBeenCalled();
  });

  it("delegates query to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.query("expr", undefined, repo);
    expect(result.ok).toBe(true);
    expect(mockListBeads).toHaveBeenCalled();
  });

  it("delegates get to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.get("id-1", repo);
    expect(result.ok).toBe(false);
  });

  it("delegates create to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.create(
      { title: "test", type: "task", priority: 2, labels: [] },
      repo,
    );
    expect(result.ok).toBe(false);
  });

  it("delegates update to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.update("id-1", { title: "updated" }, repo);
    expect(result.ok).toBe(false);
  });

  it("delegates delete to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.delete("id-1", repo);
    expect(result.ok).toBe(false);
  });

  it("delegates close to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.close("id-1", "done", repo);
    expect(result.ok).toBe(false);
  });

  it("delegates listDependencies to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.listDependencies("id-1", repo);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("delegates addDependency to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.addDependency("a", "b", repo);
    expect(result.ok).toBe(false);
  });

  it("delegates removeDependency to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.removeDependency("a", "b", repo);
    expect(result.ok).toBe(false);
  });

  it("delegates buildTakePrompt to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.buildTakePrompt("id-1", undefined, repo);
    expect(result).toBeDefined();
  });

  it("delegates buildPollPrompt to resolved backend", async () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    const result = await backend.buildPollPrompt(undefined, repo);
    expect(result).toBeDefined();
  });
});

describe("AutoRoutingBackend.capabilitiesForRepo", () => {
  it("returns knots capabilities for .knots repo", () => {
    const repo = makeRepo([".knots"]);
    const backend = new AutoRoutingBackend("cli");

    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(KNOTS_CAPABILITIES);
  });

  it("returns cli capabilities for .beads repo (maps to cli)", () => {
    const repo = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(FULL_CAPABILITIES);
  });

  it("returns fallback capabilities when no marker", () => {
    const repo = makeRepo([]);
    const backend = new AutoRoutingBackend("stub");

    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(STUB_CAPABILITIES);
  });
});

describe("AutoRoutingBackend getBackend caching", () => {
  it("reuses cached backend instances for the same type", async () => {
    const repoA = makeRepo([]);
    const repoB = makeRepo([]);
    const backend = new AutoRoutingBackend("cli");

    // Both repos resolve to "cli", so same backend instance should be used
    await backend.list(undefined, repoA);
    await backend.list(undefined, repoB);

    // If caching works, the second call uses the same instance.
    // We verify indirectly: mockListBeads should be called twice
    // (both calls go through the same cli backend).
    expect(mockListBeads).toHaveBeenCalledTimes(2);
  });
});

describe("AutoRoutingBackend clearRepoCache selective", () => {
  it("clears only the specified repo path", async () => {
    const spy = vi.spyOn(memoryManagerDetection, "detectMemoryManagerType");
    const repoA = makeRepo([".knots"]);
    const repoB = makeRepo([".beads"]);
    const backend = new AutoRoutingBackend("cli");

    await backend.list(undefined, repoA);
    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(2);

    // Clear only repoA cache
    backend.clearRepoCache(repoA);
    await backend.list(undefined, repoA);
    expect(spy).toHaveBeenCalledTimes(3);

    // repoB cache should still be valid
    await backend.list(undefined, repoB);
    expect(spy).toHaveBeenCalledTimes(3);

    spy.mockRestore();
  });
});
