import { describe, expect, it } from "vitest";
import {
  buildWorkflowDispatchPoolTargetId,
  bundledDispatchPoolGroups,
  bundledWorkflowDispatchPoolTargets,
  workflowAwarePoolTargetIdsForStep,
} from "@/lib/settings-dispatch-targets";
import { WorkflowStep } from "@/lib/workflows";

describe("settings dispatch targets", () => {
  it("builds grouped bundled workflow targets with shared sections first", () => {
    const groups = bundledDispatchPoolGroups();

    expect(groups[0]?.label).toBe("Execution Planning");
    expect(groups[1]?.label).toBe("Scope Refinement");
    expect(groups[2]?.label).toBe("Autopilot");
    expect(groups.at(-1)?.label).toBe("Semiauto (no planning)");
  });

  it("omits planning steps from no-planning bundled profiles", () => {
    const groups = bundledDispatchPoolGroups();
    const noPlanningGroup = groups.find(
      (group) => group.id === "work_sdlc__autopilot_no_planning",
    );

    expect(noPlanningGroup?.targets.map((target) => target.label)).toEqual([
      "Implementation",
      "Implementation Review",
      "Shipment",
      "Shipment Review",
    ]);
  });

  it("lists only bundled workflow targets in the bulk-apply set", () => {
    const targets = bundledWorkflowDispatchPoolTargets();

    expect(targets).not.toHaveLength(0);
    expect(
      targets.every((target) => target.id.startsWith("work_sdlc__")),
    ).toBe(true);
  });

  it("prefers workflow-specific target ids and falls back to legacy steps", () => {
    const targetIds = workflowAwarePoolTargetIdsForStep(
      WorkflowStep.Implementation,
      "autopilot_with_pr",
    );

    expect(targetIds).toEqual([
      buildWorkflowDispatchPoolTargetId(
        "work_sdlc",
        "autopilot_with_pr",
        WorkflowStep.Implementation,
      ),
      WorkflowStep.Implementation,
    ]);
  });

  it("falls back to the legacy step for unknown profiles", () => {
    expect(
      workflowAwarePoolTargetIdsForStep(
        WorkflowStep.Shipment,
        "totally-unknown-profile",
      ),
    ).toEqual([WorkflowStep.Shipment]);
  });
});
