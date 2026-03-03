import { describe, expect, it } from "vitest";
import {
  WorkflowStep,
  StepPhase,
  resolveStep,
  isQueueOrTerminal,
  isReviewStep,
  priorActionStep,
  builtinProfileDescriptor,
} from "@/lib/workflows";
import type { MemoryWorkflowOwners } from "@/lib/types";

describe("resolveStep", () => {
  it("maps all 6 queue states correctly", () => {
    expect(resolveStep("ready_for_planning")).toEqual({
      step: WorkflowStep.Planning,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_plan_review")).toEqual({
      step: WorkflowStep.PlanReview,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_implementation")).toEqual({
      step: WorkflowStep.Implementation,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_implementation_review")).toEqual({
      step: WorkflowStep.ImplementationReview,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_shipment")).toEqual({
      step: WorkflowStep.Shipment,
      phase: StepPhase.Queued,
    });
    expect(resolveStep("ready_for_shipment_review")).toEqual({
      step: WorkflowStep.ShipmentReview,
      phase: StepPhase.Queued,
    });
  });

  it("maps all 6 active states correctly", () => {
    expect(resolveStep("planning")).toEqual({
      step: WorkflowStep.Planning,
      phase: StepPhase.Active,
    });
    expect(resolveStep("plan_review")).toEqual({
      step: WorkflowStep.PlanReview,
      phase: StepPhase.Active,
    });
    expect(resolveStep("implementation")).toEqual({
      step: WorkflowStep.Implementation,
      phase: StepPhase.Active,
    });
    expect(resolveStep("implementation_review")).toEqual({
      step: WorkflowStep.ImplementationReview,
      phase: StepPhase.Active,
    });
    expect(resolveStep("shipment")).toEqual({
      step: WorkflowStep.Shipment,
      phase: StepPhase.Active,
    });
    expect(resolveStep("shipment_review")).toEqual({
      step: WorkflowStep.ShipmentReview,
      phase: StepPhase.Active,
    });
  });

  it("returns null for terminal states", () => {
    expect(resolveStep("shipped")).toBeNull();
    expect(resolveStep("abandoned")).toBeNull();
  });

  it("returns null for deferred and unknown states", () => {
    expect(resolveStep("deferred")).toBeNull();
    expect(resolveStep("unknown_state")).toBeNull();
    expect(resolveStep("")).toBeNull();
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
      const active = resolveStep(step);
      expect(active).not.toBeNull();
      expect(active!.step).toBe(step);
      expect(active!.phase).toBe(StepPhase.Active);

      // Queued phase: ready_for_<step> maps back to the same step
      const queued = resolveStep(`ready_for_${step}`);
      expect(queued).not.toBeNull();
      expect(queued!.step).toBe(step);
      expect(queued!.phase).toBe(StepPhase.Queued);
    }
  });
});

describe("isQueueOrTerminal", () => {
  const workflow = builtinProfileDescriptor("autopilot");

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
    expect(isQueueOrTerminal("unknown_state")).toBe(true);
    expect(isQueueOrTerminal("")).toBe(true);
  });

  it("works without a workflow descriptor (uses defaults)", () => {
    expect(isQueueOrTerminal("shipped")).toBe(true);
    expect(isQueueOrTerminal("abandoned")).toBe(true);
    expect(isQueueOrTerminal("closed")).toBe(true);
    expect(isQueueOrTerminal("ready_for_planning")).toBe(true);
    expect(isQueueOrTerminal("implementation")).toBe(false);
  });
});

describe("isReviewStep", () => {
  it("returns true for review steps", () => {
    expect(isReviewStep(WorkflowStep.PlanReview)).toBe(true);
    expect(isReviewStep(WorkflowStep.ImplementationReview)).toBe(true);
    expect(isReviewStep(WorkflowStep.ShipmentReview)).toBe(true);
  });

  it("returns false for action steps", () => {
    expect(isReviewStep(WorkflowStep.Planning)).toBe(false);
    expect(isReviewStep(WorkflowStep.Implementation)).toBe(false);
    expect(isReviewStep(WorkflowStep.Shipment)).toBe(false);
  });
});

describe("priorActionStep", () => {
  it("maps review steps to their corresponding action steps", () => {
    expect(priorActionStep(WorkflowStep.PlanReview)).toBe(
      WorkflowStep.Planning,
    );
    expect(priorActionStep(WorkflowStep.ImplementationReview)).toBe(
      WorkflowStep.Implementation,
    );
    expect(priorActionStep(WorkflowStep.ShipmentReview)).toBe(
      WorkflowStep.Shipment,
    );
  });

  it("returns null for non-review steps", () => {
    expect(priorActionStep(WorkflowStep.Planning)).toBeNull();
    expect(priorActionStep(WorkflowStep.Implementation)).toBeNull();
    expect(priorActionStep(WorkflowStep.Shipment)).toBeNull();
  });
});
