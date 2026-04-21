import { describe, expect, it } from "vitest";
import {
  WorkflowStep,
  StepPhase,
  resolveStep,
  isQueueOrTerminal,
  isReviewStep,
  priorActionStep,
  builtinProfileDescriptor,
  compareWorkflowStatePriority,
} from "@/lib/workflows";
import type { MemoryWorkflowOwners } from "@/lib/types";

const workflow = builtinProfileDescriptor("autopilot");

describe("resolveStep", () => {
  it("maps all 6 queue states correctly", () => {
    expect(resolveStep("ready_for_planning", workflow)).toEqual({
      step: WorkflowStep.Planning,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_plan_review", workflow)).toEqual({
      step: WorkflowStep.PlanReview,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_implementation", workflow)).toEqual({
      step: WorkflowStep.Implementation,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_implementation_review", workflow)).toEqual({
      step: WorkflowStep.ImplementationReview,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_shipment", workflow)).toEqual({
      step: WorkflowStep.Shipment,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_shipment_review", workflow)).toEqual({
      step: WorkflowStep.ShipmentReview,
      phase: StepPhase.Queued,
    });
  });

  it("maps all 6 active states correctly", () => {
    expect(resolveStep("planning", workflow)).toEqual({
      step: WorkflowStep.Planning,
      phase: StepPhase.Active,
    });
    expect(resolveStep("plan_review", workflow)).toEqual({
      step: WorkflowStep.PlanReview,
      phase: StepPhase.Active,
    });
    expect(resolveStep("implementation", workflow)).toEqual({
      step: WorkflowStep.Implementation,
      phase: StepPhase.Active,
    });
    expect(resolveStep("implementation_review", workflow)).toEqual({
      step: WorkflowStep.ImplementationReview,
      phase: StepPhase.Active,
    });
    expect(resolveStep("shipment", workflow)).toEqual({
      step: WorkflowStep.Shipment,
      phase: StepPhase.Active,
    });
    expect(resolveStep("shipment_review", workflow)).toEqual({
      step: WorkflowStep.ShipmentReview,
      phase: StepPhase.Active,
    });
  });

  it("returns null for terminal states", () => {
    expect(resolveStep("shipped", workflow)).toBeNull();
    expect(resolveStep("abandoned", workflow)).toBeNull();
  });

  it("returns null for deferred and unknown states", () => {
    expect(resolveStep("deferred", workflow)).toBeNull();
    expect(resolveStep("unknown_state", workflow)).toBeNull();
    expect(resolveStep("", workflow)).toBeNull();
  });

  it("all WorkflowStep values are valid MemoryWorkflowOwners keys", () => {
    const ownerKeys: (keyof MemoryWorkflowOwners)[] = [
      "planning",
      "plan_review",
      "implementation",
      "implementation_review",
      "shipment",
      "shipment_review",
    ];
    const stepValues = Object.values(WorkflowStep);
    for (const step of stepValues) {
      expect(ownerKeys).toContain(step);
    }
  });

  it("every WorkflowStep in both phases round-trips", () => {
    const steps = Object.values(WorkflowStep);
    for (const step of steps) {
      // Active phase: step name maps back to the same step
      const active = resolveStep(step, workflow);
      expect(active).not.toBeNull();
      expect(active!.step).toBe(step);
      expect(active!.phase).toBe(StepPhase.Active);

      // Queued phase: ready_for_<step> maps back to the same step
      const queued = resolveStep(`ready_for_${step}`, workflow);
      expect(queued).not.toBeNull();
      expect(queued!.step).toBe(step);
      expect(queued!.phase).toBe(StepPhase.Queued);
    }
  });
});

describe("isQueueOrTerminal", () => {
  it("returns true for all queue states", () => {
    expect(isQueueOrTerminal("ready_for_planning", workflow)).toBe(true);
    expect(isQueueOrTerminal("ready_for_plan_review", workflow)).toBe(true);
    expect(isQueueOrTerminal("ready_for_implementation", workflow)).toBe(true);
    expect(isQueueOrTerminal("ready_for_implementation_review", workflow)).toBe(true);
    expect(isQueueOrTerminal("ready_for_shipment", workflow)).toBe(true);
    expect(isQueueOrTerminal("ready_for_shipment_review", workflow)).toBe(true);
  });

  it("returns true for terminal states", () => {
    expect(isQueueOrTerminal("shipped", workflow)).toBe(true);
    expect(isQueueOrTerminal("abandoned", workflow)).toBe(true);
  });

  it("returns true for deferred state", () => {
    expect(isQueueOrTerminal("deferred", workflow)).toBe(true);
  });

  it("returns false for all action (active) states", () => {
    expect(isQueueOrTerminal("planning", workflow)).toBe(false);
    expect(isQueueOrTerminal("plan_review", workflow)).toBe(false);
    expect(isQueueOrTerminal("implementation", workflow)).toBe(false);
    expect(isQueueOrTerminal("implementation_review", workflow)).toBe(false);
    expect(isQueueOrTerminal("shipment", workflow)).toBe(false);
    expect(isQueueOrTerminal("shipment_review", workflow)).toBe(false);
  });

  it("returns true for unknown states (not action states)", () => {
    expect(isQueueOrTerminal("unknown_state", workflow)).toBe(true);
    expect(isQueueOrTerminal("", workflow)).toBe(true);
  });
});

describe("isReviewStep", () => {
  it("returns true for review steps", () => {
    expect(isReviewStep(WorkflowStep.PlanReview, workflow)).toBe(true);
    expect(isReviewStep(WorkflowStep.ImplementationReview, workflow)).toBe(true);
    expect(isReviewStep(WorkflowStep.ShipmentReview, workflow)).toBe(true);
  });

  it("returns false for action steps", () => {
    expect(isReviewStep(WorkflowStep.Planning, workflow)).toBe(false);
    expect(isReviewStep(WorkflowStep.Implementation, workflow)).toBe(false);
    expect(isReviewStep(WorkflowStep.Shipment, workflow)).toBe(false);
  });
});

describe("priorActionStep", () => {
  it("maps review steps to their corresponding action steps", () => {
    expect(priorActionStep(WorkflowStep.PlanReview, workflow)).toBe(
      WorkflowStep.Planning,
    );
    expect(priorActionStep(WorkflowStep.ImplementationReview, workflow)).toBe(
      WorkflowStep.Implementation,
    );
    expect(priorActionStep(WorkflowStep.ShipmentReview, workflow)).toBe(
      WorkflowStep.Shipment,
    );
  });

  it("returns null for non-review steps", () => {
    expect(priorActionStep(WorkflowStep.Planning, workflow)).toBeNull();
    expect(priorActionStep(WorkflowStep.Implementation, workflow)).toBeNull();
    expect(priorActionStep(WorkflowStep.Shipment, workflow)).toBeNull();
  });
});

describe("compareWorkflowStatePriority", () => {
  it("orders known workflow states by pipeline order", () => {
    const states = [
      "shipment_review",
      "ready_for_implementation",
      "planning",
      "ready_for_planning",
      "implementation",
    ];

    expect(states.sort(compareWorkflowStatePriority)).toEqual([
      "ready_for_planning",
      "planning",
      "ready_for_implementation",
      "implementation",
      "shipment_review",
    ]);
  });

  it("sorts unknown states after known states", () => {
    const states = ["custom_beta", "ready_for_shipment", "custom_alpha"];

    expect(states.sort(compareWorkflowStatePriority)).toEqual([
      "ready_for_shipment",
      "custom_alpha",
      "custom_beta",
    ]);
  });
});
