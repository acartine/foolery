import { describe, it, expect } from "vitest";
import type { Bead } from "@/lib/types";
import { buildHierarchy } from "@/lib/bead-hierarchy";
import { compareBeadsByPriorityThenStatus } from "@/lib/bead-sort";

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

describe("compareBeadsByPriorityThenStatus", () => {
  it("sorts by priority first (0 is highest)", () => {
    const beads = [
      makeBead({ id: "p3", priority: 3 }),
      makeBead({ id: "p0", priority: 0 }),
      makeBead({ id: "p1", priority: 1 }),
    ];

    const sorted = beads.slice().sort(compareBeadsByPriorityThenStatus);
    expect(sorted.map((b) => b.id)).toEqual(["p0", "p1", "p3"]);
  });

  it("sorts equal-priority beads by status rank", () => {
    const beads = [
      makeBead({ id: "blocked", status: "blocked", priority: 2 }),
      makeBead({ id: "closed", status: "closed", priority: 2 }),
      makeBead({ id: "open", status: "open", priority: 2 }),
      makeBead({ id: "inprogress", status: "in_progress", priority: 2 }),
      makeBead({ id: "deferred", status: "deferred", priority: 2 }),
    ];

    const sorted = beads.slice().sort(compareBeadsByPriorityThenStatus);
    expect(sorted.map((b) => b.id)).toEqual([
      "open",
      "inprogress",
      "closed",
      "blocked",
      "deferred",
    ]);
  });

  it("keeps children under parents when used with buildHierarchy", () => {
    const beads = [
      makeBead({ id: "p1-parent", priority: 1 }),
      makeBead({ id: "p0-root", priority: 0 }),
      makeBead({ id: "p0-child", parent: "p1-parent", priority: 0 }),
    ];

    const hierarchy = buildHierarchy(beads, compareBeadsByPriorityThenStatus);
    expect(hierarchy.map((b) => [b.id, b._depth])).toEqual([
      ["p0-root", 0],
      ["p1-parent", 0],
      ["p0-child", 1],
    ]);
  });
});
