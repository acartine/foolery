import { describe, expect, it } from "vitest";
import {
  WorkflowStep,
  StepPhase,
  resolveStep,
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
