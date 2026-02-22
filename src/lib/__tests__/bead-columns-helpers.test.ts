import { describe, expect, it } from "vitest";
import {
  verifyBeadFields,
  rejectBeadFields,
  getBeadColumns,
} from "@/components/bead-columns";
import type { Bead } from "@/lib/types";

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: "proj-abc",
    title: "Test bead",
    type: "task",
    status: "open",
    priority: 2,
    labels: [],
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("verifyBeadFields", () => {
  it("returns status closed and removes stage:verification", () => {
    const result = verifyBeadFields();
    expect(result.status).toBe("closed");
    expect(result.removeLabels).toEqual(["stage:verification"]);
  });
});

describe("rejectBeadFields", () => {
  it("returns open status with retry label and attempt count 1 for first rejection", () => {
    const bead = makeBead({ labels: ["stage:verification", "foo"] });
    const result = rejectBeadFields(bead);
    expect(result.status).toBe("open");
    expect(result.removeLabels).toEqual(["stage:verification"]);
    expect(result.labels).toContain("stage:retry");
    expect(result.labels).toContain("attempts:1");
  });

  it("increments attempt count for subsequent rejections", () => {
    const bead = makeBead({
      labels: ["stage:verification", "attempts:2"],
    });
    const result = rejectBeadFields(bead);
    expect(result.status).toBe("open");
    expect(result.removeLabels).toContain("stage:verification");
    expect(result.removeLabels).toContain("attempts:2");
    expect(result.labels).toContain("attempts:3");
  });

  it("handles bead with no labels", () => {
    const bead = makeBead({ labels: undefined as unknown as string[] });
    const result = rejectBeadFields(bead);
    expect(result.status).toBe("open");
    expect(result.labels).toContain("attempts:1");
  });
});

describe("getBeadColumns", () => {
  it("returns an array of column definitions", () => {
    const cols = getBeadColumns();
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBeGreaterThan(0);
  });

  it("returns columns with boolean false (legacy compat)", () => {
    const cols = getBeadColumns(false);
    expect(Array.isArray(cols)).toBe(true);
  });

  it("returns columns with boolean true for showRepoColumn", () => {
    const cols = getBeadColumns(true);
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(true);
  });

  it("adds repo column when showRepoColumn is true in opts", () => {
    const cols = getBeadColumns({ showRepoColumn: true });
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(true);
  });

  it("does not add repo column when showRepoColumn is false", () => {
    const cols = getBeadColumns({ showRepoColumn: false });
    const hasRepo = cols.some((c) => c.id === "_repoName");
    expect(hasRepo).toBe(false);
  });

  it("adds ship column when onShipBead is provided", () => {
    const cols = getBeadColumns({ onShipBead: () => {} });
    const hasShip = cols.some((c) => c.id === "ship");
    expect(hasShip).toBe(true);
  });

  it("does not add ship column when onShipBead is not provided", () => {
    const cols = getBeadColumns({});
    const hasShip = cols.some((c) => c.id === "ship");
    expect(hasShip).toBe(false);
  });

  it("always includes select, id, title, priority, type, status columns", () => {
    const cols = getBeadColumns();
    const ids = cols.map((c) => c.id ?? (c as unknown as { accessorKey?: string }).accessorKey);
    expect(ids).toContain("select");
    expect(ids).toContain("id");
    expect(ids).toContain("title");
    expect(ids).toContain("priority");
    expect(ids).toContain("type");
    expect(ids).toContain("status");
  });
});
