import { describe, it, expect } from "vitest";
import type { Beat } from "@/lib/types";
import { compareBeadsByPriorityThenStatus } from "@/lib/bead-sort";

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

describe("compareBeadsByPriorityThenStatus - ID tiebreaker", () => {
  it("falls back to id comparison when priority, status, and title are equal", () => {
    const beats = [
      makeBeat({ id: "z-bead", title: "Same Title" }),
      makeBeat({ id: "a-bead", title: "Same Title" }),
      makeBeat({ id: "m-bead", title: "Same Title" }),
    ];

    const sorted = beats.slice().sort(compareBeadsByPriorityThenStatus);
    expect(sorted.map((b) => b.id)).toEqual(["a-bead", "m-bead", "z-bead"]);
  });

  it("sorts by title before falling back to id", () => {
    const beats = [
      makeBeat({ id: "aaa", title: "Zebra" }),
      makeBeat({ id: "zzz", title: "Alpha" }),
    ];

    const sorted = beats.slice().sort(compareBeadsByPriorityThenStatus);
    expect(sorted.map((b) => b.id)).toEqual(["zzz", "aaa"]);
  });

  it("sorts deterministically with identical titles and priority", () => {
    const beats = [
      makeBeat({ id: "c", title: "X" }),
      makeBeat({ id: "a", title: "X" }),
      makeBeat({ id: "b", title: "X" }),
    ];

    const sorted1 = beats.slice().sort(compareBeadsByPriorityThenStatus);
    const sorted2 = beats.slice().reverse().sort(compareBeadsByPriorityThenStatus);
    expect(sorted1.map((b) => b.id)).toEqual(sorted2.map((b) => b.id));
  });
});
