import { describe, expect, it } from "vitest";
import { partitionEligibleForTerminalTarget } from "../use-bulk-actions";
import type { Beat } from "@/lib/types";

function makeBeat(id: string, state: string): Beat {
  return {
    id,
    title: `Beat ${id}`,
    type: "work",
    state,
  } as Beat;
}

describe("partitionEligibleForTerminalTarget", () => {
  it("partitions already-terminal beats from eligible ones", () => {
    const beats = [
      makeBeat("a", "implementation"),
      makeBeat("b", "shipped"),
      makeBeat("c", "abandoned"),
      makeBeat("d", "ready_for_implementation"),
    ];
    const result = partitionEligibleForTerminalTarget(
      ["a", "b", "c", "d"],
      beats,
      "shipped",
    );
    expect(result.eligibleIds).toEqual(["a", "d"]);
    expect(result.skippedIds).toEqual(["b", "c"]);
  });

  it("skips beats already in the target state even when not in terminalStates", () => {
    const beats = [
      makeBeat("a", "deferred"),
      makeBeat("b", "implementation"),
    ];
    const result = partitionEligibleForTerminalTarget(
      ["a", "b"],
      beats,
      "deferred",
    );
    expect(result.eligibleIds).toEqual(["b"]);
    expect(result.skippedIds).toEqual(["a"]);
  });

  it("normalizes state casing and whitespace", () => {
    const beats = [
      makeBeat("a", "  SHIPPED "),
      makeBeat("b", "planning"),
    ];
    const result = partitionEligibleForTerminalTarget(
      ["a", "b"],
      beats,
      "Shipped",
    );
    expect(result.eligibleIds).toEqual(["b"]);
    expect(result.skippedIds).toEqual(["a"]);
  });

  it("treats unknown beat ids as eligible (backend decides)", () => {
    const beats = [makeBeat("a", "implementation")];
    const result = partitionEligibleForTerminalTarget(
      ["a", "missing"],
      beats,
      "shipped",
    );
    expect(result.eligibleIds).toEqual(["a", "missing"]);
    expect(result.skippedIds).toEqual([]);
  });

  it("returns all skipped when every selected beat is terminal", () => {
    const beats = [
      makeBeat("a", "shipped"),
      makeBeat("b", "abandoned"),
    ];
    const result = partitionEligibleForTerminalTarget(
      ["a", "b"],
      beats,
      "shipped",
    );
    expect(result.eligibleIds).toEqual([]);
    expect(result.skippedIds).toEqual(["a", "b"]);
  });

  it("treats 'closed' beats as terminal for ship targets", () => {
    const beats = [
      makeBeat("a", "closed"),
      makeBeat("b", "planning"),
    ];
    const result = partitionEligibleForTerminalTarget(
      ["a", "b"],
      beats,
      "shipped",
    );
    expect(result.eligibleIds).toEqual(["b"]);
    expect(result.skippedIds).toEqual(["a"]);
  });
});
