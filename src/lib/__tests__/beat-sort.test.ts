import { describe, it, expect } from "vitest";
import type { Beat } from "@/lib/types";
import { buildHierarchy } from "@/lib/beat-hierarchy";
import {
  compareBeatsByPriorityThenState,
  compareBeatsByHierarchicalOrder,
  naturalCompare,
} from "@/lib/beat-sort";

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

describe("compareBeatsByPriorityThenState", () => {
  it("sorts by priority first (0 is highest)", () => {
    const beats = [
      makeBeat({ id: "p3", priority: 3 }),
      makeBeat({ id: "p0", priority: 0 }),
      makeBeat({ id: "p1", priority: 1 }),
    ];

    const sorted = beats.slice().sort(compareBeatsByPriorityThenState);
    expect(sorted.map((b) => b.id)).toEqual(["p0", "p1", "p3"]);
  });

  it("sorts equal-priority beats by state rank", () => {
    const beats = [
      makeBeat({ id: "blocked", state: "blocked", priority: 2 }),
      makeBeat({ id: "shipped", state: "shipped", priority: 2 }),
      makeBeat({ id: "queue", state: "ready_for_planning", priority: 2 }),
      makeBeat({ id: "action", state: "implementation", priority: 2 }),
      makeBeat({ id: "deferred", state: "deferred", priority: 2 }),
    ];

    const sorted = beats.slice().sort(compareBeatsByPriorityThenState);
    expect(sorted.map((b) => b.id)).toEqual([
      "queue",
      "action",
      "shipped",
      "blocked",
      "deferred",
    ]);
  });

  it("keeps children under parents when used with buildHierarchy", () => {
    const beats = [
      makeBeat({ id: "p1-parent", priority: 1 }),
      makeBeat({ id: "p0-root", priority: 0 }),
      makeBeat({ id: "p0-child", parent: "p1-parent", priority: 0 }),
    ];

    const hierarchy = buildHierarchy(beats, compareBeatsByPriorityThenState);
    expect(hierarchy.map((b) => [b.id, b._depth])).toEqual([
      ["p0-root", 0],
      ["p1-parent", 0],
      ["p0-child", 1],
    ]);
  });
});

describe("naturalCompare", () => {
  it("sorts strings with numeric segments in natural order", () => {
    const items = ["item-10", "item-2", "item-1", "item-20", "item-3"];
    const sorted = items.slice().sort(naturalCompare);
    expect(sorted).toEqual(["item-1", "item-2", "item-3", "item-10", "item-20"]);
  });

  it("sorts hierarchical dot-notation IDs correctly", () => {
    const items = ["1guy.4", "1guy.3", "1guy.1", "1guy.5", "1guy.2"];
    const sorted = items.slice().sort(naturalCompare);
    expect(sorted).toEqual(["1guy.1", "1guy.2", "1guy.3", "1guy.4", "1guy.5"]);
  });

  it("sorts multi-level hierarchical IDs correctly", () => {
    const items = ["mqv.2.10", "mqv.2.2", "mqv.2.1", "mqv.10.1", "mqv.1.1"];
    const sorted = items.slice().sort(naturalCompare);
    expect(sorted).toEqual(["mqv.1.1", "mqv.2.1", "mqv.2.2", "mqv.2.10", "mqv.10.1"]);
  });

  it("sorts purely alphabetic strings lexicographically", () => {
    const items = ["charlie", "alpha", "bravo"];
    const sorted = items.slice().sort(naturalCompare);
    expect(sorted).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("handles beads-prefixed IDs", () => {
    const items = ["beads-1guy.3", "beads-1guy.1", "beads-1guy.10", "beads-1guy.2"];
    const sorted = items.slice().sort(naturalCompare);
    expect(sorted).toEqual(["beads-1guy.1", "beads-1guy.2", "beads-1guy.3", "beads-1guy.10"]);
  });
});

describe("compareBeatsByHierarchicalOrder", () => {
  it("sorts siblings by natural ID order regardless of priority", () => {
    const beats = [
      makeBeat({ id: "1guy.4", priority: 0 }),
      makeBeat({ id: "1guy.3", priority: 1 }),
      makeBeat({ id: "1guy.1", priority: 3 }),
      makeBeat({ id: "1guy.5", priority: 2 }),
      makeBeat({ id: "1guy.2", priority: 0 }),
    ];

    const sorted = beats.slice().sort(compareBeatsByHierarchicalOrder);
    expect(sorted.map((b) => b.id)).toEqual([
      "1guy.1", "1guy.2", "1guy.3", "1guy.4", "1guy.5",
    ]);
  });

  it("preserves hierarchy when used with buildHierarchy", () => {
    const beats = [
      makeBeat({ id: "1guy" }),
      makeBeat({ id: "1guy.4", parent: "1guy", priority: 0 }),
      makeBeat({ id: "1guy.3", parent: "1guy", priority: 1 }),
      makeBeat({ id: "1guy.1", parent: "1guy", priority: 3 }),
      makeBeat({ id: "1guy.5", parent: "1guy", priority: 2 }),
      makeBeat({ id: "1guy.2", parent: "1guy", priority: 0 }),
    ];

    const hierarchy = buildHierarchy(beats, compareBeatsByHierarchicalOrder);
    expect(hierarchy.map((b) => [b.id, b._depth])).toEqual([
      ["1guy", 0],
      ["1guy.1", 1],
      ["1guy.2", 1],
      ["1guy.3", 1],
      ["1guy.4", 1],
      ["1guy.5", 1],
    ]);
  });
});
