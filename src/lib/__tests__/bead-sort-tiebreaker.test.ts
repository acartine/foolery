import { describe, it, expect } from "vitest";
import type { Bead } from "@/lib/types";
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

describe("compareBeadsByPriorityThenStatus - ID tiebreaker", () => {
  it("falls back to id comparison when priority, status, and title are equal", () => {
    const beads = [
      makeBead({ id: "z-bead", title: "Same Title" }),
      makeBead({ id: "a-bead", title: "Same Title" }),
      makeBead({ id: "m-bead", title: "Same Title" }),
    ];

    const sorted = beads.slice().sort(compareBeadsByPriorityThenStatus);
    expect(sorted.map((b) => b.id)).toEqual(["a-bead", "m-bead", "z-bead"]);
  });

  it("sorts by title before falling back to id", () => {
    const beads = [
      makeBead({ id: "aaa", title: "Zebra" }),
      makeBead({ id: "zzz", title: "Alpha" }),
    ];

    const sorted = beads.slice().sort(compareBeadsByPriorityThenStatus);
    expect(sorted.map((b) => b.id)).toEqual(["zzz", "aaa"]);
  });

  it("sorts deterministically with identical titles and priority", () => {
    const beads = [
      makeBead({ id: "c", title: "X" }),
      makeBead({ id: "a", title: "X" }),
      makeBead({ id: "b", title: "X" }),
    ];

    const sorted1 = beads.slice().sort(compareBeadsByPriorityThenStatus);
    const sorted2 = beads.slice().reverse().sort(compareBeadsByPriorityThenStatus);
    expect(sorted1.map((b) => b.id)).toEqual(sorted2.map((b) => b.id));
  });
});
