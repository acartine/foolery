import { describe, expect, it } from "vitest";
import {
  verifyBeadFields,
  rejectBeadFields,
  getBeadColumns,
} from "@/components/bead-columns";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "proj-abc",
    title: "Test beat",
    type: "task",
    state: "open",
    priority: 2,
    labels: [],
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("verifyBeadFields", () => {
  it("returns state shipped", () => {
    const result = verifyBeadFields();
    expect(result.state).toBe("shipped");
  });
});

describe("rejectBeadFields", () => {
  it("returns ready_for_implementation state with attempt count 1 for first rejection", () => {
    const bead = makeBeat({ labels: ["stage:verification", "foo"] });
    const result = rejectBeadFields(bead);
    expect(result.state).toBe("ready_for_implementation");
    expect(result.removeLabels).toBeUndefined();
    expect(result.labels).toContain("attempts:1");
  });

  it("increments attempt count for subsequent rejections", () => {
    const bead = makeBeat({
      labels: ["stage:verification", "attempts:2"],
    });
    const result = rejectBeadFields(bead);
    expect(result.state).toBe("ready_for_implementation");
    expect(result.removeLabels).not.toContain("stage:verification");
    expect(result.removeLabels).toContain("attempts:2");
    expect(result.labels).toContain("attempts:3");
  });

  it("handles bead with no labels", () => {
    const bead = makeBeat({ labels: undefined as unknown as string[] });
    const result = rejectBeadFields(bead);
    expect(result.state).toBe("ready_for_implementation");
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

  it("adds ship column when onShipBeat is provided", () => {
    const cols = getBeadColumns({ onShipBeat: () => {} });
    const hasShip = cols.some((c) => c.id === "ship");
    expect(hasShip).toBe(true);
  });

  it("does not add ship column when onShipBeat is not provided", () => {
    const cols = getBeadColumns({});
    const hasShip = cols.some((c) => c.id === "ship");
    expect(hasShip).toBe(false);
  });
});
