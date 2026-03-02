import { describe, it, expect } from "vitest";
import { buildHierarchy } from "@/lib/beat-hierarchy";
import { compareBeatsByPriorityThenState } from "@/lib/beat-sort";
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

describe("buildHierarchy", () => {
  it("returns flat beats at depth 0 when no parents", () => {
    const beats = [makeBeat({ id: "a" }), makeBeat({ id: "b" })];
    const result = buildHierarchy(beats);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["a", 0, false],
      ["b", 0, false],
    ]);
  });

  it("nests children under their parent", () => {
    const beats = [
      makeBeat({ id: "parent" }),
      makeBeat({ id: "child1", parent: "parent" }),
      makeBeat({ id: "child2", parent: "parent" }),
    ];
    const result = buildHierarchy(beats);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["parent", 0, true],
      ["child1", 1, false],
      ["child2", 1, false],
    ]);
  });

  it("handles multi-level nesting", () => {
    const beats = [
      makeBeat({ id: "root" }),
      makeBeat({ id: "mid", parent: "root" }),
      makeBeat({ id: "leaf", parent: "mid" }),
    ];
    const result = buildHierarchy(beats);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["root", 0, true],
      ["mid", 1, true],
      ["leaf", 2, false],
    ]);
  });

  it("treats beats with missing parent as top-level", () => {
    const beats = [
      makeBeat({ id: "orphan", parent: "nonexistent" }),
      makeBeat({ id: "root" }),
    ];
    const result = buildHierarchy(beats);
    expect(result.map((b) => [b.id, b._depth, b._hasChildren])).toEqual([
      ["orphan", 0, false],
      ["root", 0, false],
    ]);
  });

  describe("sortChildren", () => {
    it("reorders siblings by priority then state", () => {
      const beats = [
        makeBeat({ id: "parent" }),
        makeBeat({ id: "low", parent: "parent", priority: 3 }),
        makeBeat({ id: "high", parent: "parent", priority: 1 }),
      ];
      const result = buildHierarchy(beats, compareBeatsByPriorityThenState);
      expect(result.map((b) => [b.id, b._depth])).toEqual([
        ["parent", 0],
        ["high", 1],
        ["low", 1],
      ]);
    });

    it("children never escape their parent subtree", () => {
      // A child with higher priority must stay under its parent, not jump out.
      const beats = [
        makeBeat({ id: "mqv", priority: 2 }),
        makeBeat({ id: "mqv.1", parent: "mqv", priority: 0 }),
        makeBeat({ id: "mqv.2", parent: "mqv", priority: 3 }),
        makeBeat({ id: "mqv.2.5", parent: "mqv.2", priority: 0 }),
        makeBeat({ id: "mqv.2.6", parent: "mqv.2", priority: 1 }),
        makeBeat({ id: "mqv.5", parent: "mqv", priority: 1 }),
      ];
      const result = buildHierarchy(beats, compareBeatsByPriorityThenState);
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

    it("sorts top-level beats by priority", () => {
      const beats = [
        makeBeat({ id: "low", priority: 4 }),
        makeBeat({ id: "high", priority: 1 }),
      ];
      const result = buildHierarchy(beats, compareBeatsByPriorityThenState);
      expect(result.map((b) => b.id)).toEqual(["high", "low"]);
    });
  });
});
