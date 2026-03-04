import { describe, expect, it } from "vitest";
import { validNextStates } from "@/components/beat-detail";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

/** Minimal workflow descriptor with transitions matching the canonical autopilot profile. */
function autopilotWorkflow(): MemoryWorkflowDescriptor {
  return {
    id: "autopilot",
    backingWorkflowId: "autopilot",
    label: "Knots (autopilot)",
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

describe("validNextStates", () => {
  const workflow = autopilotWorkflow();

  it("returns empty for undefined currentState", () => {
    expect(validNextStates(undefined, workflow)).toEqual([]);
  });

  it("returns queued-row transitions without ready_for_* states", () => {
    const result = validNextStates("ready_for_planning", workflow);
    expect(result).toContain("planning");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
    // Queued rows should not list queue-to-queue targets in normal flow
    expect(result.some((s) => s.startsWith("ready_for_"))).toBe(false);
  });

  describe("rolled-back active state (stuck knot)", () => {
    it("computes transitions from the raw kno state, not the display state", () => {
      // Display: ready_for_planning, Raw: planning
      // Transitions from "planning" include ready_for_plan_review
      const result = validNextStates("ready_for_planning", workflow, "planning");
      expect(result).toContain("ready_for_plan_review");
    });

    it("excludes both the display state and the raw kno state from results", () => {
      const result = validNextStates("ready_for_planning", workflow, "planning");
      expect(result).not.toContain("ready_for_planning");
      expect(result).not.toContain("planning");
    });

    it("includes non-terminal workflow states as escape hatches", () => {
      const result = validNextStates("ready_for_planning", workflow, "planning");
      // Should include states from workflow that are not terminal
      expect(result).toContain("ready_for_implementation");
      expect(result).toContain("implementation");
      expect(result).toContain("deferred");
    });

    it("does not add terminal states via escape hatches but allows them from transitions", () => {
      const result = validNextStates("ready_for_planning", workflow, "planning");
      // "shipped" is terminal and not reachable from "planning" via transitions — excluded
      expect(result).not.toContain("shipped");
      // "abandoned" and "deferred" are reachable via wildcard transitions from any state
      expect(result).toContain("abandoned");
      expect(result).toContain("deferred");
    });

    it("includes ready_for_* states when rolled back (unlike normal flow)", () => {
      const result = validNextStates("ready_for_planning", workflow, "planning");
      // In rolled-back mode, ready_for_* states should be included as escape hatches
      expect(result).toContain("ready_for_implementation");
      expect(result).toContain("ready_for_plan_review");
    });

    it("handles implementation stuck state", () => {
      // Display: ready_for_implementation, Raw: implementation
      const result = validNextStates("ready_for_implementation", workflow, "implementation");
      // Transitions from "implementation" include ready_for_implementation_review
      expect(result).toContain("ready_for_implementation_review");
      // Should not include self
      expect(result).not.toContain("ready_for_implementation");
      expect(result).not.toContain("implementation");
    });
  });

  describe("normal flow (no rollback)", () => {
    it("includes ready_for_* targets for active rows", () => {
      const result = validNextStates("planning", workflow);
      expect(result).toContain("ready_for_plan_review");
    });

    it("normalizes short impl state to implementation for transitions", () => {
      const result = validNextStates("impl", workflow);
      expect(result).toContain("ready_for_implementation_review");
      expect(result).toContain("deferred");
      expect(result).toContain("abandoned");
    });

    it("does not include the current state", () => {
      const result = validNextStates("planning", workflow);
      expect(result).not.toContain("planning");
    });

    it("treats matching rawKnoState and display state as normal flow", () => {
      // When rawKnoState matches currentState, it's not rolled back
      const result = validNextStates("ready_for_planning", workflow, "ready_for_planning");
      expect(result).toContain("planning");
      // Should filter out ready_for_* (normal flow)
      expect(result.some((s) => s.startsWith("ready_for_"))).toBe(false);
    });

    it("normalizes rawKnoState before rollback detection", () => {
      // Same state with casing/whitespace should still be treated as non-rollback
      const result = validNextStates(
        "ready_for_planning",
        workflow,
        " Ready_For_Planning ",
      );
      expect(result).toContain("planning");
      expect(result.some((s) => s.startsWith("ready_for_"))).toBe(false);
    });
  });
});
