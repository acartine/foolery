import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  listBeads: () => mockListBeads(),
  readyBeads: () => mockListBeads(),
  searchBeads: () => mockListBeads(),
  queryBeads: () => mockListBeads(),
  showBead: vi.fn(async () => ({ ok: false, error: "not found" })),
  createBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  deleteBead: vi.fn(async () => ({ ok: false, error: "not implemented" })),
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
      workflow_etag: "etag",
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
}));

const mockListEdges = vi.fn(async () => ({ ok: true as const, data: [] }));

vi.mock("@/lib/knots", () => ({
  listKnots: () => mockListKnots(),
  showKnot: vi.fn(async () => ({ ok: false, error: "not found" })),
  newKnot: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateKnot: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  listEdges: () => mockListEdges(),
  addEdge: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  removeEdge: vi.fn(async () => ({ ok: false, error: "not implemented" })),
}));

import { createBackend } from "@/lib/backend-factory";

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
