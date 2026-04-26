import { describe, expect, it } from "vitest";
import { validNextStates } from "@/components/beat-detail";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

/**
 * `validNextStates` MUST only offer transitions that exist in the
 * loom-derived `workflow.transitions` list. Earlier queue states
 * that lack an explicit transition (e.g. `implementation_review →
 * ready_for_implementation_review` — "un-claim a review") are
 * exception flow and live behind the Rewind submenu (`force: true`),
 * not in the normal dropdown. See CLAUDE.md §"State Classification
 * Is Loom-Derived" and §"kno Workflows Are Authoritative".
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

const workflow = autopilotWorkflow();

describe("validNextStates - basics", () => {
  it("returns empty for undefined currentState", () => {
    expect(validNextStates(undefined, workflow)).toEqual([]);
  });

  it("returns only loom-defined transitions from a queue state", () => {
    const result = validNextStates("ready_for_planning", workflow);
    expect(result).toContain("planning");
    expect(result).toContain("deferred");
    expect(result).toContain("abandoned");
    expect(result).not.toContain("ready_for_planning");
  });
});

describe("validNextStates - rolled-back active state (stuck knot)", () => {
    it("computes transitions from the raw kno state, not the display state", () => {
      // Display: ready_for_planning, Raw: planning
      // Loom transition: planning → ready_for_plan_review
      const result = validNextStates("ready_for_planning", workflow, "planning");
      expect(result).toContain("ready_for_plan_review");
    });

    it("excludes both the display state and the raw kno state from results", () => {
      const result = validNextStates("ready_for_planning", workflow, "planning");
      expect(result).not.toContain("ready_for_planning");
      expect(result).not.toContain("planning");
    });

    it("does NOT inject non-loom escape hatches when rolled back", () => {
      // Old buggy behavior added every non-terminal state. New
      // behavior: only loom-defined transitions from the raw state.
      const result = validNextStates("ready_for_planning", workflow, "planning");
      // From "planning" the loom only allows → ready_for_plan_review
      // plus wildcards (deferred, abandoned). It does NOT allow
      // jumping forward to ready_for_implementation or implementation.
      expect(result).not.toContain("ready_for_implementation");
      expect(result).not.toContain("implementation");
    });

    it("lists only the wildcard terminals actually in the workflow", () => {
      const result = validNextStates("ready_for_planning", workflow, "planning");
      // Only `abandoned` and `deferred` are reachable via wildcard
      // transitions in the loom. `shipped` is reachable only from
      // `shipment_review` and is not a wildcard target.
      expect(result).toContain("abandoned");
      expect(result).toContain("deferred");
      expect(result).not.toContain("shipped");
    });

    it("handles implementation stuck state with only loom-legal options", () => {
      // Display: ready_for_implementation, Raw: implementation
      // Loom transitions FROM implementation:
      //   → ready_for_implementation_review (the only forward edge)
      //   * → deferred / abandoned (wildcards)
      const result = validNextStates(
        "ready_for_implementation", workflow, "implementation",
      );
      expect(result).toContain("ready_for_implementation_review");
      expect(result).toContain("deferred");
      expect(result).toContain("abandoned");
      // No "back to my own queue" — that's force-only via Rewind.
      expect(result).not.toContain("ready_for_implementation");
      // No display/raw self-references.
      expect(result).not.toContain("implementation");
    });
});

describe("validNextStates - normal flow (no rollback)", () => {
    it("includes loom-defined ready_for_* targets for active rows", () => {
      const result = validNextStates("planning", workflow);
      expect(result).toContain("ready_for_plan_review");
    });

    it("does NOT offer same-step queue rollback from active rows", () => {
      // The user's principle: rolling back to your own ready queue is
      // exception flow (un-claim) and requires --force via Rewind.
      const result = validNextStates("implementation", workflow);
      expect(result).not.toContain("ready_for_implementation");
    });

    it("does NOT offer earlier queue states as rollback targets", () => {
      // Old buggy behavior added every earlier ready_for_* state. New
      // behavior: only loom-defined transitions appear.
      const result = validNextStates("implementation", workflow);
      expect(result).not.toContain("ready_for_planning");
      expect(result).not.toContain("ready_for_plan_review");
      expect(result).not.toContain("ready_for_implementation");
    });

    it("offers exactly the loom-defined transitions from shipment_review", () => {
      const result = validNextStates("shipment_review", workflow);
      // Loom transitions FROM shipment_review:
      //   → shipped, ready_for_implementation, ready_for_shipment
      //   * → deferred, abandoned (wildcards)
      expect(result).toContain("shipped");
      expect(result).toContain("ready_for_implementation");
      expect(result).toContain("ready_for_shipment");
      expect(result).toContain("deferred");
      expect(result).toContain("abandoned");
      // Earlier queue states without explicit transitions are NOT
      // offered (force-only via Rewind).
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

    it("does not include the current state", () => {
      const result = validNextStates("planning", workflow);
      expect(result).not.toContain("planning");
    });

    it("treats matching rawKnoState and display state as normal flow", () => {
      const result = validNextStates(
        "ready_for_planning", workflow, "ready_for_planning",
      );
      expect(result).toContain("planning");
    });

    it("normalizes rawKnoState before rollback detection", () => {
      const result = validNextStates(
        "ready_for_planning",
        workflow,
        " Ready_For_Planning ",
      );
      expect(result).toContain("planning");
    });
});

describe("validNextStates - gate states do not offer self-queue rollback", () => {
    // The motivating bug: from implementation_review the UI offered
    // ready_for_implementation_review (un-claim). That transition is
    // not in the loom — it's exception flow and must go through
    // Rewind (force: true), not the normal dropdown.
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
