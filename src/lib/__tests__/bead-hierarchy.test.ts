import { describe, it, expect } from "vitest";
import { buildHierarchy } from "@/lib/bead-hierarchy";
import { compareBeadsByPriorityThenStatus } from "@/lib/bead-sort";
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

describe("buildHierarchy", () => {
  it("returns flat beads at depth 0 when no parents", () => {
    const beads = [makeBead({ id: "a" }), makeBead({ id: "b" })];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["a", 0, false],
      ["b", 0, false],
    ]);
  });

  it("nests children under their parent", () => {
    const beads = [
      makeBead({ id: "parent" }),
      makeBead({ id: "child1", parent: "parent" }),
      makeBead({ id: "child2", parent: "parent" }),
    ];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["parent", 0, true],
      ["child1", 1, false],
      ["child2", 1, false],
    ]);
  });

  it("handles multi-level nesting", () => {
    const beads = [
      makeBead({ id: "root" }),
      makeBead({ id: "mid", parent: "root" }),
      makeBead({ id: "leaf", parent: "mid" }),
    ];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["root", 0, true],
      ["mid", 1, true],
      ["leaf", 2, false],
    ]);
  });

  it("treats beads with missing parent as top-level", () => {
    const beads = [
      makeBead({ id: "orphan", parent: "nonexistent" }),
      makeBead({ id: "root" }),
    ];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["orphan", 0, false],
      ["root", 0, false],
    ]);
  });

  describe("sortChildren", () => {
    it("reorders siblings by priority then status", () => {
      const beads = [
        makeBead({ id: "parent" }),
        makeBead({ id: "low", parent: "parent", priority: 3 }),
        makeBead({ id: "high", parent: "parent", priority: 1 }),
      ];
      const result = buildHierarchy(beads, compareBeadsByPriorityThenStatus);
      expect(result.map((b) => [b.id, b._depth])).toEqual([
        ["parent", 0],
        ["high", 1],
        ["low", 1],
      ]);
    });

    it("children never escape their parent subtree", () => {
      // A child with higher priority must stay under its parent, not jump out.
      const beads = [
        makeBead({ id: "mqv", priority: 2 }),
        makeBead({ id: "mqv.1", parent: "mqv", priority: 0 }),
        makeBead({ id: "mqv.2", parent: "mqv", priority: 3 }),
        makeBead({ id: "mqv.2.5", parent: "mqv.2", priority: 0 }),
        makeBead({ id: "mqv.2.6", parent: "mqv.2", priority: 1 }),
        makeBead({ id: "mqv.5", parent: "mqv", priority: 1 }),
      ];
      const result = buildHierarchy(beads, compareBeadsByPriorityThenStatus);
      const ids = result.map((b) => b.id);
      const depths = result.map((b) => b._depth);

      // Children stay under their parent sorted by priority
      expect(result.map((b) => [b.id, b._depth])).toEqual([
        ["mqv", 0],
        ["mqv.1", 1],      // priority 0, first child
        ["mqv.5", 1],      // priority 1, second child
        ["mqv.2", 1],      // priority 3, last child
        ["mqv.2.5", 2],    // child of mqv.2, priority 0
        ["mqv.2.6", 2],    // child of mqv.2, priority 1
      ]);

      // Key invariant: mqv.2.5 and mqv.2.6 must be AFTER mqv.2
      const idx2 = ids.indexOf("mqv.2");
      const idx25 = ids.indexOf("mqv.2.5");
      const idx26 = ids.indexOf("mqv.2.6");
      expect(idx25).toBeGreaterThan(idx2);
      expect(idx26).toBeGreaterThan(idx2);

      // All nested items must have a parent entry preceding them
      for (let i = 0; i < result.length; i++) {
        if (depths[i] > 0) {
          const parentDepth = depths[i] - 1;
          const preceding = result.slice(0, i).reverse();
          const parentEntry = preceding.find((b) => b._depth === parentDepth);
          expect(parentEntry).toBeDefined();
        }
      }
    });

    it("sorts top-level beads by priority", () => {
      const beads = [
        makeBead({ id: "low", priority: 4 }),
        makeBead({ id: "high", priority: 1 }),
      ];
      const result = buildHierarchy(beads, compareBeadsByPriorityThenStatus);
      expect(result.map((b) => b.id)).toEqual(["high", "low"]);
    });
  });
});
