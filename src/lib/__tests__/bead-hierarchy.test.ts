import { describe, it, expect } from "vitest";
import { buildHierarchy } from "@/lib/bead-hierarchy";
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
    expect(result.map((b) => [b.id, b._depth])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("nests children under their parent", () => {
    const beads = [
      makeBead({ id: "parent" }),
      makeBead({ id: "child1", parent: "parent" }),
      makeBead({ id: "child2", parent: "parent" }),
    ];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth])).toEqual([
      ["parent", 0],
      ["child1", 1],
      ["child2", 1],
    ]);
  });

  it("handles multi-level nesting", () => {
    const beads = [
      makeBead({ id: "root" }),
      makeBead({ id: "mid", parent: "root" }),
      makeBead({ id: "leaf", parent: "mid" }),
    ];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth])).toEqual([
      ["root", 0],
      ["mid", 1],
      ["leaf", 2],
    ]);
  });

  it("treats beads with missing parent as top-level", () => {
    const beads = [
      makeBead({ id: "orphan", parent: "nonexistent" }),
      makeBead({ id: "root" }),
    ];
    const result = buildHierarchy(beads);
    expect(result.map((b) => [b.id, b._depth])).toEqual([
      ["orphan", 0],
      ["root", 0],
    ]);
  });

  describe("sortChildren", () => {
    it("reorders siblings within the same parent", () => {
      const beads = [
        makeBead({ id: "parent" }),
        makeBead({ id: "b", parent: "parent", labels: [] }),
        makeBead({ id: "a", parent: "parent", labels: ["stage:verification"] }),
      ];
      const verifyFirst = (a: Bead, b: Bead) => {
        const aV = a.labels?.includes("stage:verification") ? 0 : 1;
        const bV = b.labels?.includes("stage:verification") ? 0 : 1;
        return aV - bV;
      };
      const result = buildHierarchy(beads, verifyFirst);
      expect(result.map((b) => [b.id, b._depth])).toEqual([
        ["parent", 0],
        ["a", 1],
        ["b", 1],
      ]);
    });

    it("children never escape their parent subtree (bug reproduction)", () => {
      // Reproduces the exact bug: mqv.2.5 and mqv.2.6 have verification labels
      // but mqv.2 does not. A flat sort would pull 2.5/2.6 out of the mqv.2 subtree.
      const beads = [
        makeBead({ id: "mqv" }),
        makeBead({ id: "mqv.1", parent: "mqv", labels: ["stage:verification"] }),
        makeBead({ id: "mqv.2", parent: "mqv", labels: [] }),
        makeBead({ id: "mqv.2.5", parent: "mqv.2", labels: ["stage:verification"] }),
        makeBead({ id: "mqv.2.6", parent: "mqv.2", labels: ["stage:verification"] }),
        makeBead({ id: "mqv.5", parent: "mqv", labels: ["stage:verification"] }),
      ];
      const verifyFirst = (a: Bead, b: Bead) => {
        const aV = a.labels?.includes("stage:verification") ? 0 : 1;
        const bV = b.labels?.includes("stage:verification") ? 0 : 1;
        return aV - bV;
      };
      const result = buildHierarchy(beads, verifyFirst);
      const ids = result.map((b) => b.id);
      const depths = result.map((b) => b._depth);

      // mqv.2.5 and mqv.2.6 must appear directly after mqv.2, not next to mqv.5
      expect(result.map((b) => [b.id, b._depth])).toEqual([
        ["mqv", 0],
        ["mqv.1", 1],      // verification, sorted before mqv.2
        ["mqv.5", 1],      // verification, sorted before mqv.2
        ["mqv.2", 1],      // no verification, at the end of mqv's children
        ["mqv.2.5", 2],    // child of mqv.2
        ["mqv.2.6", 2],    // child of mqv.2
      ]);

      // Key invariant: mqv.2.5 and mqv.2.6 must be AFTER mqv.2 and BEFORE the next depth-1 sibling
      const idx2 = ids.indexOf("mqv.2");
      const idx25 = ids.indexOf("mqv.2.5");
      const idx26 = ids.indexOf("mqv.2.6");
      expect(idx25).toBeGreaterThan(idx2);
      expect(idx26).toBeGreaterThan(idx2);

      // All depth-2 items must have a depth-1+ parent preceding them
      for (let i = 0; i < result.length; i++) {
        if (depths[i] > 0) {
          // There must be a preceding entry with depth = depths[i] - 1
          const parentDepth = depths[i] - 1;
          const preceding = result.slice(0, i).reverse();
          const parentEntry = preceding.find((b) => b._depth === parentDepth);
          expect(parentEntry).toBeDefined();
        }
      }
    });

    it("sorts top-level beads too", () => {
      const beads = [
        makeBead({ id: "b", labels: [] }),
        makeBead({ id: "a", labels: ["stage:verification"] }),
      ];
      const verifyFirst = (a: Bead, b: Bead) => {
        const aV = a.labels?.includes("stage:verification") ? 0 : 1;
        const bV = b.labels?.includes("stage:verification") ? 0 : 1;
        return aV - bV;
      };
      const result = buildHierarchy(beads, verifyFirst);
      expect(result.map((b) => b.id)).toEqual(["a", "b"]);
    });
  });
});
