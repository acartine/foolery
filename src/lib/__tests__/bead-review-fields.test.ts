import { describe, expect, it } from "vitest";
import type { Bead } from "@/lib/types";
import { rejectBeadFields, verifyBeadFields } from "@/components/bead-columns";

function makeBead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: "foolery-123",
    title: "Test Bead",
    description: "",
    status: "in_progress",
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
      status: "closed",
      removeLabels: ["stage:verification"],
    });
  });

  it("builds reject fields with incremented attempts", () => {
    const bead = makeBead({ labels: ["stage:verification", "attempts:3"] });

    expect(rejectBeadFields(bead)).toEqual({
      status: "open",
      removeLabels: ["stage:verification", "attempts:3"],
      labels: ["stage:retry", "attempts:4"],
    });
  });
});
