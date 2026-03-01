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

describe("filterByVisibleAncestorChain", () => {
  it("keeps descendants when the full ancestor chain exists", () => {
    const beats = [
      makeBeat({ id: "root" }),
      makeBeat({ id: "root.1", parent: "root" }),
      makeBeat({ id: "root.1.1", parent: "root.1" }),
    ];
    expect(filterByVisibleAncestorChain(beats).map((b) => b.id)).toEqual([
      "root",
      "root.1",
      "root.1.1",
    ]);
  });

  it("drops descendants when an intermediate parent is missing", () => {
    const beats = [
      makeBeat({ id: "root" }),
      makeBeat({ id: "root.2.1", parent: "root.2" }),
      makeBeat({ id: "root.2.1.a", parent: "root.2.1" }),
    ];
    expect(filterByVisibleAncestorChain(beats).map((b) => b.id)).toEqual([
      "root",
    ]);
  });

  it("preserves ready siblings while hiding descendants of excluded branches", () => {
    const beats = [
      makeBeat({ id: "qqla" }),
      makeBeat({ id: "qqla.1", parent: "qqla" }),
      makeBeat({ id: "qqla.1.1", parent: "qqla.1" }),
      // Simulate qqla.2 filtered out as non-ready, but its children still present.
      makeBeat({ id: "qqla.2.1", parent: "qqla.2" }),
      makeBeat({ id: "qqla.2.2", parent: "qqla.2" }),
    ];
    expect(filterByVisibleAncestorChain(beats).map((b) => b.id)).toEqual([
      "qqla",
      "qqla.1",
      "qqla.1.1",
    ]);
  });
});
