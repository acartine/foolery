import { describe, expect, it } from "vitest";
import type { Beat } from "@/lib/types";
import { rejectBeadFields, verifyBeadFields } from "@/components/bead-columns";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-123",
    title: "Test Beat",
    description: "",
    state: "in_progress",
    priority: 2,
    type: "task",
    labels: [],
    created: "2026-02-14T00:00:00.000Z",
    updated: "2026-02-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("review field builders", () => {
  it("builds atomic verify fields", () => {
    expect(verifyBeadFields()).toEqual({
      state: "shipped",
    });
  });

  it("builds reject fields with incremented attempts", () => {
    const bead = makeBeat({ labels: ["stage:verification", "attempts:3"] });

    expect(rejectBeadFields(bead)).toEqual({
      state: "ready_for_implementation",
      removeLabels: ["attempts:3"],
      labels: ["attempts:4"],
    });
  });
});
