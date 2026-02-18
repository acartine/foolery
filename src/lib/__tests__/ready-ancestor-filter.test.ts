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

describe("filterByVisibleAncestorChain", () => {
  it("keeps descendants when the full ancestor chain exists", () => {
    const beads = [
      makeBead({ id: "root" }),
      makeBead({ id: "root.1", parent: "root" }),
      makeBead({ id: "root.1.1", parent: "root.1" }),
    ];
    expect(filterByVisibleAncestorChain(beads).map((b) => b.id)).toEqual([
      "root",
      "root.1",
      "root.1.1",
    ]);
  });

  it("drops descendants when an intermediate parent is missing", () => {
    const beads = [
      makeBead({ id: "root" }),
      makeBead({ id: "root.2.1", parent: "root.2" }),
      makeBead({ id: "root.2.1.a", parent: "root.2.1" }),
    ];
    expect(filterByVisibleAncestorChain(beads).map((b) => b.id)).toEqual([
      "root",
    ]);
  });

  it("preserves ready siblings while hiding descendants of excluded branches", () => {
    const beads = [
      makeBead({ id: "qqla" }),
      makeBead({ id: "qqla.1", parent: "qqla" }),
      makeBead({ id: "qqla.1.1", parent: "qqla.1" }),
      // Simulate qqla.2 filtered out as non-ready, but its children still present.
      makeBead({ id: "qqla.2.1", parent: "qqla.2" }),
      makeBead({ id: "qqla.2.2", parent: "qqla.2" }),
    ];
    expect(filterByVisibleAncestorChain(beads).map((b) => b.id)).toEqual([
      "qqla",
      "qqla.1",
      "qqla.1.1",
    ]);
  });
});
