import { describe, expect, it } from "vitest";
import {
  builtinProfileDescriptor,
  forwardTransitionTarget,
} from "@/lib/workflows";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

/** Minimal workflow with explicit transitions for deterministic testing. */
function testWorkflow(): MemoryWorkflowDescriptor {
  return {
    id: "test",
    backingWorkflowId: "test",
    label: "Test",
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
      { from: "plan_review", to: "ready_for_planning" }, // rollback
      { from: "ready_for_implementation", to: "implementation" },
      { from: "implementation", to: "ready_for_implementation_review" },
      { from: "ready_for_implementation_review", to: "implementation_review" },
      { from: "implementation_review", to: "ready_for_shipment" },
      { from: "implementation_review", to: "ready_for_implementation" }, // rollback
      { from: "ready_for_shipment", to: "shipment" },
      { from: "shipment", to: "ready_for_shipment_review" },
      { from: "ready_for_shipment_review", to: "shipment_review" },
      { from: "shipment_review", to: "shipped" },
      { from: "shipment_review", to: "ready_for_implementation" }, // rollback
      { from: "shipment_review", to: "ready_for_shipment" }, // rollback
      { from: "*", to: "deferred" },
      { from: "*", to: "abandoned" },
    ],
    finalCutState: null,
    retakeState: "ready_for_implementation",
    promptProfileId: "test",
  };
}

describe("forwardTransitionTarget", () => {
  const workflow = testWorkflow();

  it("returns the forward target for a queued state", () => {
    expect(forwardTransitionTarget("ready_for_planning", workflow)).toBe("planning");
  });

  it("returns the forward target for an active state", () => {
    expect(forwardTransitionTarget("planning", workflow)).toBe("ready_for_plan_review");
  });

  it("returns forward target from implementation to review queue", () => {
    expect(forwardTransitionTarget("implementation", workflow)).toBe(
      "ready_for_implementation_review",
    );
  });

  it("excludes rollback transitions from plan_review", () => {
    // plan_review has both ready_for_implementation (forward) and ready_for_planning (rollback)
    expect(forwardTransitionTarget("plan_review", workflow)).toBe("ready_for_implementation");
  });

  it("excludes rollback transitions from implementation_review", () => {
    // implementation_review has ready_for_shipment (forward) and ready_for_implementation (rollback)
    expect(forwardTransitionTarget("implementation_review", workflow)).toBe("ready_for_shipment");
  });

  it("excludes rollback transitions from shipment_review", () => {
    // shipment_review has shipped (forward), ready_for_implementation (rollback), ready_for_shipment (rollback)
    expect(forwardTransitionTarget("shipment_review", workflow)).toBe("shipped");
  });

  it("returns null for terminal states with no outgoing transitions", () => {
    expect(forwardTransitionTarget("shipped", workflow)).toBeNull();
  });

  it("returns null for unknown states", () => {
    expect(forwardTransitionTarget("nonexistent", workflow)).toBeNull();
  });

  it("returns null when workflow has no transitions", () => {
    const noTransitions: MemoryWorkflowDescriptor = {
      ...workflow,
      transitions: undefined,
    };
    expect(forwardTransitionTarget("planning", noTransitions)).toBeNull();
  });

  it("works with builtin autopilot profile", () => {
    const autopilot = builtinProfileDescriptor("autopilot");
    expect(forwardTransitionTarget("ready_for_implementation", autopilot)).toBe("implementation");
    expect(forwardTransitionTarget("implementation", autopilot)).toBe(
      "ready_for_implementation_review",
    );
  });

  it("works with builtin semiauto profile", () => {
    const semiauto = builtinProfileDescriptor("semiauto");
    expect(forwardTransitionTarget("ready_for_planning", semiauto)).toBe("planning");
  });

  it("handles queued-to-active and active-to-next-queue transitions", () => {
    // queued -> active
    expect(forwardTransitionTarget("ready_for_shipment", workflow)).toBe("shipment");
    // active -> next queue
    expect(forwardTransitionTarget("shipment", workflow)).toBe("ready_for_shipment_review");
  });
});
