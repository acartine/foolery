import { describe, expect, it } from "vitest";
import { filterByVisibleAncestorChain } from "@/lib/ready-ancestor-filter";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> & { id: string }): Beat {
  return {
    title: overrides.id,
    type: "task",
    state: "open",
    priority: 2,
    labels: [],
    created: "2025-01-01T00:00:00Z",
    updated: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("filterByVisibleAncestorChain - cycle detection", () => {
  it("handles self-referencing parent (a -> a)", () => {
    const beats = [makeBeat({ id: "a", parent: "a" })];
    const result = filterByVisibleAncestorChain(beats);
    expect(result.map((b) => b.id)).toEqual([]);
  });

  it("handles two-node cycle (a -> b -> a)", () => {
    const beats = [
      makeBeat({ id: "a", parent: "b" }),
      makeBeat({ id: "b", parent: "a" }),
    ];
    const result = filterByVisibleAncestorChain(beats);
    expect(result.map((b) => b.id)).toEqual([]);
  });

  it("handles three-node cycle (a -> b -> c -> a)", () => {
    const beats = [
      makeBeat({ id: "a", parent: "b" }),
      makeBeat({ id: "b", parent: "c" }),
      makeBeat({ id: "c", parent: "a" }),
    ];
    const result = filterByVisibleAncestorChain(beats);
    expect(result.map((b) => b.id)).toEqual([]);
  });

  it("keeps beads unrelated to cycle", () => {
    const beats = [
      makeBeat({ id: "root" }),
      makeBeat({ id: "child", parent: "root" }),
      // Cyclic pair
      makeBeat({ id: "x", parent: "y" }),
      makeBeat({ id: "y", parent: "x" }),
    ];
    const result = filterByVisibleAncestorChain(beats);
    expect(result.map((b) => b.id)).toEqual(["root", "child"]);
  });

  it("keeps roots (beads with no parent)", () => {
    const beats = [
      makeBeat({ id: "a" }),
      makeBeat({ id: "b" }),
    ];
    const result = filterByVisibleAncestorChain(beats);
    expect(result.map((b) => b.id)).toEqual(["a", "b"]);
  });
});
