/**
 * Additional coverage tests for backend-factory.ts.
 *
 * The uncovered lines (169-170, 193-194) are exhaustive default branches
 * with `never` type guards that cannot be reached in TypeScript. This file
 * covers the remaining edge cases:
 *  - AutoRoutingBackend strict no-fallback behaviour when no repoPath given
 *  - capabilitiesForRepo advisory fallback to FULL_CAPABILITIES
 *  - createBackend for each concrete type
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockListBeats = vi.fn(async () => ({
  ok: true as const,
  data: [
    {
      id: "bd-cov-1",
      title: "Coverage item",
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
  listBeats: () => mockListBeats(),
  readyBeats: () => mockListBeats(),
  searchBeats: () => mockListBeats(),
  queryBeats: () => mockListBeats(),
  showBeat: vi.fn(async () => ({ ok: false, error: "not found" })),
  createBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  deleteBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  closeBeat: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  listDeps: vi.fn(async () => ({ ok: true, data: [] })),
  addDep: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  removeDep: vi.fn(async () => ({ ok: false, error: "not implemented" })),
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
        "ready_for_implementation",
        "implementation",
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
  listWorkflows: vi.fn(async () => ({ ok: true as const, data: [] })),
  listKnots: vi.fn(async () => ({ ok: true as const, data: [] })),
  showKnot: vi.fn(async () => ({ ok: false, error: "not found" })),
  newKnot: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  updateKnot: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  listEdges: vi.fn(async () => ({ ok: true as const, data: [] })),
  addEdge: vi.fn(async () => ({ ok: false, error: "not implemented" })),
  removeEdge: vi.fn(async () => ({ ok: false, error: "not implemented" })),
}));

import { createBackend, AutoRoutingBackend } from "@/lib/backend-factory";
import { FULL_CAPABILITIES } from "@/lib/backend-capabilities";
import { DispatchFailureError } from "@/lib/dispatch-pool-resolver";

function makeRepo(markerDirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "foolery-factory-cov-"));
  for (const marker of markerDirs) {
    mkdirSync(join(dir, marker), { recursive: true });
  }
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AutoRoutingBackend strict no-fallback contract", () => {
  it("list() with no repoPath throws DispatchFailureError", async () => {
    const backend = new AutoRoutingBackend();
    await expect(backend.list()).rejects.toBeInstanceOf(DispatchFailureError);
  });

  it("list() against a beads-marked repo routes through BdCliBackend", async () => {
    const backend = new AutoRoutingBackend();
    const repo = makeRepo([".beads"]);
    const result = await backend.list(undefined, repo);
    expect(result.ok).toBe(true);
    expect(mockListBeats).toHaveBeenCalled();
  });

  it("capabilitiesForRepo without path returns FULL_CAPABILITIES (advisory only)", () => {
    const backend = new AutoRoutingBackend();
    const caps = backend.capabilitiesForRepo();
    expect(caps).toEqual(FULL_CAPABILITIES);
  });

  it("capabilitiesForRepo for an unknown repo returns FULL_CAPABILITIES (advisory only)", () => {
    const backend = new AutoRoutingBackend();
    const repo = makeRepo([]);
    const caps = backend.capabilitiesForRepo(repo);
    expect(caps).toEqual(FULL_CAPABILITIES);
  });
});

describe("createBackend edge cases", () => {
  it("returns auto routing backend with FULL_CAPABILITIES", () => {
    const entry = createBackend("auto");
    expect(entry.port).toBeDefined();
    expect(entry.capabilities).toEqual(FULL_CAPABILITIES);
  });

  it("auto backend proxies operations through the resolved backend when repo is recognised", async () => {
    const repo = makeRepo([".beads"]);
    const entry = createBackend("auto");

    const listResult = await entry.port.list(undefined, repo);
    expect(listResult.ok).toBe(true);

    const workflowResult = await entry.port.listWorkflows(repo);
    expect(workflowResult.ok).toBe(true);
  });

  it("auto backend listWorkflows() with no repoPath returns builtin descriptors", async () => {
    const entry = createBackend("auto");
    const result = await entry.port.listWorkflows();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data ?? []).length).toBeGreaterThan(0);
  });
});
