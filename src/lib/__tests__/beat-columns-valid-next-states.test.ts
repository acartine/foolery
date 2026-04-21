import { describe, expect, it } from "vitest";
import { validNextStates } from "@/components/beat-columns";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

/** Minimal workflow descriptor with transitions matching the canonical autopilot profile. */
function autopilotWorkflow(): MemoryWorkflowDescriptor {
  return {
    id: "autopilot",
    backingWorkflowId: "autopilot",
    label: "Autopilot",
    mode: "granular_autonomous",
    initialState: "ready_for_planning",
    states: [
      "ready_for_planning",
      "planning",
      "ready_for_plan_review",
      "plan_review",
      "ready_for_implementation",
      "implementation",
      "ready_for_implementation_review",
      "implementation_review",
      "ready_for_shipment",
      "shipment",
      "ready_for_shipment_review",
      "shipment_review",
      "shipped",
      "deferred",
      "abandoned",
    ],
    terminalStates: ["shipped", "abandoned"],
    transitions: [
      { from: "ready_for_planning", to: "planning" },
      { from: "planning", to: "ready_for_plan_review" },
      { from: "ready_for_plan_review", to: "plan_review" },
      { from: "plan_review", to: "ready_for_implementation" },
      { from: "plan_review", to: "ready_for_planning" },
      { from: "ready_for_implementation", to: "implementation" },
      { from: "implementation", to: "ready_for_implementation_review" },
      { from: "ready_for_implementation_review", to: "implementation_review" },
      { from: "implementation_review", to: "ready_for_shipment" },
      { from: "implementation_review", to: "ready_for_implementation" },
      { from: "ready_for_shipment", to: "shipment" },
      { from: "shipment", to: "ready_for_shipment_review" },
      { from: "ready_for_shipment_review", to: "shipment_review" },
      { from: "shipment_review", to: "shipped" },
      { from: "shipment_review", to: "ready_for_implementation" },
      { from: "shipment_review", to: "ready_for_shipment" },
      { from: "*", to: "deferred" },
      { from: "*", to: "abandoned" },
    ],
    finalCutState: null,
    retakeState: "ready_for_implementation",
    promptProfileId: "autopilot",
  };
}

describe("beat-columns validNextStates", () => {
  const workflow = autopilotWorkflow();

  it("returns empty for undefined current state", () => {
    expect(validNextStates(undefined, workflow)).toEqual([]);
  });

  it("filters ready_for_* states for queued rows in normal flow", () => {
    const result = validNextStates("ready_for_planning", workflow);
    expect(result).toContain("planning");
    expect(result.some((state) => state.startsWith("ready_for_"))).toBe(false);
  });

  it("includes ready_for_* targets for active rows in normal flow", () => {
    const result = validNextStates("implementation", workflow);
    expect(result).toContain("ready_for_implementation_review");
  });

  it("includes same-step queued rollback target for active rows", () => {
    const result = validNextStates("implementation", workflow);
    expect(result).toContain("ready_for_implementation");
  });

  it("includes all earlier queue states as rollback targets for active rows", () => {
    const result = validNextStates("implementation", workflow);
    expect(result).toContain("ready_for_planning");
    expect(result).toContain("ready_for_plan_review");
    expect(result).toContain("ready_for_implementation");
  });

  it("includes all earlier queue states for shipment_review", () => {
    const result = validNextStates("shipment_review", workflow);
    expect(result).toContain("ready_for_planning");
    expect(result).toContain("ready_for_plan_review");
    expect(result).toContain("ready_for_implementation");
    expect(result).toContain("ready_for_implementation_review");
    expect(result).toContain("ready_for_shipment");
    expect(result).toContain("ready_for_shipment_review");
  });

  it("normalizes short impl state to implementation for transitions", () => {
    const result = validNextStates("impl", workflow);
    expect(result).toContain("ready_for_implementation_review");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
  });

  it("computes from raw kno state and includes queued escape hatches when rolled back", () => {
    const result = validNextStates("ready_for_planning", workflow, "planning");
    expect(result).toContain("ready_for_plan_review");
    expect(result).toContain("ready_for_implementation_review");
    expect(result).not.toContain("ready_for_planning");
    expect(result).not.toContain("planning");
  });

  it("normalizes raw kno state before rollback detection", () => {
    const result = validNextStates(
      "ready_for_planning",
      workflow,
      " Ready_For_Planning ",
    );
    expect(result).toContain("planning");
    expect(result.some((state) => state.startsWith("ready_for_"))).toBe(false);
  });
});
