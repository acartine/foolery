import { describe, expect, it } from "vitest";
import { validNextStates } from "@/components/beat-columns";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

/**
 * Table-view sibling of `validNextStates`. Same principle: only
 * loom-defined transitions appear in the dropdown; force-required
 * jumps (earlier queue states without an explicit transition,
 * alternate action states) are exception flow and live behind the
 * Rewind submenu in the detail view. See CLAUDE.md §"State
 * Classification Is Loom-Derived".
 */
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
    queueStates: [
      "ready_for_planning",
      "ready_for_plan_review",
      "ready_for_implementation",
      "ready_for_implementation_review",
      "ready_for_shipment",
      "ready_for_shipment_review",
    ],
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

  it("returns only loom-defined transitions from a queue state", () => {
    const result = validNextStates("ready_for_planning", workflow);
    expect(result).toContain("planning");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
    // Self excluded; no fabricated rollbacks.
    expect(result).not.toContain("ready_for_planning");
  });

  it("includes loom-defined ready_for_* targets for active rows", () => {
    const result = validNextStates("implementation", workflow);
    expect(result).toContain("ready_for_implementation_review");
  });

  it("does NOT offer same-step queue rollback from active rows", () => {
    // Un-claiming back to your own queue is exception flow → Rewind.
    const result = validNextStates("implementation", workflow);
    expect(result).not.toContain("ready_for_implementation");
  });

  it("does NOT offer earlier queue states as rollback targets", () => {
    // Old buggy behavior added every earlier ready_for_* state.
    // New: only loom-defined transitions appear.
    const result = validNextStates("implementation", workflow);
    expect(result).not.toContain("ready_for_planning");
    expect(result).not.toContain("ready_for_plan_review");
  });

  it("offers exactly the loom-defined transitions from shipment_review", () => {
    const result = validNextStates("shipment_review", workflow);
    expect(result).toContain("shipped");
    expect(result).toContain("ready_for_implementation");
    expect(result).toContain("ready_for_shipment");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
    // Force-only rollback targets are NOT in the dropdown.
    expect(result).not.toContain("ready_for_planning");
    expect(result).not.toContain("ready_for_plan_review");
    expect(result).not.toContain("ready_for_implementation_review");
    expect(result).not.toContain("ready_for_shipment_review");
  });

  it("normalizes short impl state to implementation for transitions", () => {
    const result = validNextStates("impl", workflow);
    expect(result).toContain("ready_for_implementation_review");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
  });

  it("computes from raw kno state when display differs and offers only loom-legal moves", () => {
    const result = validNextStates("ready_for_planning", workflow, "planning");
    // From "planning" the loom only allows → ready_for_plan_review
    // plus wildcards. No fabricated escape hatches.
    expect(result).toContain("ready_for_plan_review");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
    expect(result).not.toContain("ready_for_planning");
    expect(result).not.toContain("planning");
    expect(result).not.toContain("ready_for_implementation");
    expect(result).not.toContain("implementation");
  });

  it("normalizes raw kno state before rollback detection", () => {
    const result = validNextStates(
      "ready_for_planning",
      workflow,
      " Ready_For_Planning ",
    );
    expect(result).toContain("planning");
  });

  describe("gate states do not offer self-queue rollback", () => {
    for (const gate of [
      "plan_review",
      "implementation_review",
      "shipment_review",
    ]) {
      it(`from ${gate} does not offer ready_for_${gate}`, () => {
        const result = validNextStates(gate, workflow);
        expect(result).not.toContain(`ready_for_${gate}`);
      });
    }
  });
});
