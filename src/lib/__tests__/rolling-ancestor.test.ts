import { describe, expect, it } from "vitest";
import { hasRollingAncestor } from "@/lib/rolling-ancestor";

function makeParentMap(pairs: [string, string | undefined][]): Map<string, string | undefined> {
  return new Map(pairs);
}

describe("hasRollingAncestor", () => {
  it("returns false when beat has no parent", () => {
    const result = hasRollingAncestor(
      { id: "b1", parent: undefined },
      makeParentMap([["b1", undefined]]),
      {},
    );
    expect(result).toBe(false);
  });

  it("returns true when direct parent is rolling", () => {
    const result = hasRollingAncestor(
      { id: "b2", parent: "b1" },
      makeParentMap([["b1", undefined], ["b2", "b1"]]),
      { b1: "session-1" },
    );
    expect(result).toBe(true);
  });

  it("returns true when grandparent is rolling", () => {
    const result = hasRollingAncestor(
      { id: "b3", parent: "b2" },
      makeParentMap([["b1", undefined], ["b2", "b1"], ["b3", "b2"]]),
      { b1: "session-1" },
    );
    expect(result).toBe(true);
  });

  it("detects rolling grandparent even when intermediate parent is absent from retake candidates", () => {
    // This is the regression case: b2 is not a retake candidate but IS in
    // the full beat set. The parent map must be built from all beats.
    const result = hasRollingAncestor(
      { id: "b3", parent: "b2" },
      makeParentMap([["b1", undefined], ["b2", "b1"], ["b3", "b2"]]),
      { b1: "session-1" },
    );
    expect(result).toBe(true);
  });

  it("returns false when no ancestor is rolling", () => {
    const result = hasRollingAncestor(
      { id: "b3", parent: "b2" },
      makeParentMap([["b1", undefined], ["b2", "b1"], ["b3", "b2"]]),
      {},
    );
    expect(result).toBe(false);
  });

  it("handles cycles without infinite loop", () => {
    // b1 -> b2 -> b1 (cycle)
    const result = hasRollingAncestor(
      { id: "b1", parent: "b2" },
      makeParentMap([["b1", "b2"], ["b2", "b1"]]),
      {},
    );
    expect(result).toBe(false);
  });

  it("handles parent not in map (broken chain)", () => {
    const result = hasRollingAncestor(
      { id: "b2", parent: "b1" },
      makeParentMap([["b2", "b1"]]),
      {},
    );
    expect(result).toBe(false);
  });

  it("walks through multiple generations to find rolling ancestor", () => {
    // b4 -> b3 -> b2 -> b1 (rolling)
    const result = hasRollingAncestor(
      { id: "b4", parent: "b3" },
      makeParentMap([
        ["b1", undefined],
        ["b2", "b1"],
        ["b3", "b2"],
        ["b4", "b3"],
      ]),
      { b1: "session-1" },
    );
    expect(result).toBe(true);
  });
});
