import { describe, expect, it } from "vitest";
import { filterByVisibleAncestorChain } from "@/lib/ready-ancestor-filter";
import type { Bead } from "@/lib/types";

function makeBead(overrides: Partial<Bead> & { id: string }): Bead {
  return {
    title: overrides.id,
    type: "task",
    status: "open",
    priority: 2,
    labels: [],
    created: "2025-01-01T00:00:00Z",
    updated: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("filterByVisibleAncestorChain - cycle detection", () => {
  it("handles self-referencing parent (a -> a)", () => {
    const beads = [makeBead({ id: "a", parent: "a" })];
    const result = filterByVisibleAncestorChain(beads);
    expect(result.map((b) => b.id)).toEqual([]);
  });

  it("handles two-node cycle (a -> b -> a)", () => {
    const beads = [
      makeBead({ id: "a", parent: "b" }),
      makeBead({ id: "b", parent: "a" }),
    ];
    const result = filterByVisibleAncestorChain(beads);
    expect(result.map((b) => b.id)).toEqual([]);
  });

  it("handles three-node cycle (a -> b -> c -> a)", () => {
    const beads = [
      makeBead({ id: "a", parent: "b" }),
      makeBead({ id: "b", parent: "c" }),
      makeBead({ id: "c", parent: "a" }),
    ];
    const result = filterByVisibleAncestorChain(beads);
    expect(result.map((b) => b.id)).toEqual([]);
  });

  it("keeps beads unrelated to cycle", () => {
    const beads = [
      makeBead({ id: "root" }),
      makeBead({ id: "child", parent: "root" }),
      // Cyclic pair
      makeBead({ id: "x", parent: "y" }),
      makeBead({ id: "y", parent: "x" }),
    ];
    const result = filterByVisibleAncestorChain(beads);
    expect(result.map((b) => b.id)).toEqual(["root", "child"]);
  });

  it("keeps roots (beads with no parent)", () => {
    const beads = [
      makeBead({ id: "a" }),
      makeBead({ id: "b" }),
    ];
    const result = filterByVisibleAncestorChain(beads);
    expect(result.map((b) => b.id)).toEqual(["a", "b"]);
  });
});
