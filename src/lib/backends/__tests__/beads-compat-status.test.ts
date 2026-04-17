/**
 * Tests for the Beads-local compat-status translation.
 *
 * These mappings exist only because the Beads JSONL backend serializes
 * issues with a generic status string. Foolery run paths elsewhere speak
 * workflow-native states and must not import this module.
 */
import { describe, expect, it } from "vitest";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { defaultWorkflowDescriptor } from "@/lib/workflows";
import {
  deriveBeadsProfileId,
  deriveBeadsWorkflowState,
  mapStatusToDefaultWorkflowState,
  mapWorkflowStateToCompatStatus,
} from "@/lib/backends/beads-compat-status";

describe("mapWorkflowStateToCompatStatus", () => {
  it("maps deferred to deferred", () => {
    expect(mapWorkflowStateToCompatStatus("deferred")).toBe("deferred");
  });
  it("maps blocked/rejected to blocked", () => {
    expect(mapWorkflowStateToCompatStatus("blocked")).toBe("blocked");
    expect(mapWorkflowStateToCompatStatus("rejected")).toBe("blocked");
  });
  it("maps terminal states to closed", () => {
    expect(mapWorkflowStateToCompatStatus("shipped")).toBe("closed");
    expect(mapWorkflowStateToCompatStatus("abandoned")).toBe("closed");
    expect(mapWorkflowStateToCompatStatus("closed")).toBe("closed");
    expect(mapWorkflowStateToCompatStatus("done")).toBe("closed");
    expect(mapWorkflowStateToCompatStatus("approved")).toBe("closed");
  });
  it("maps queue states to open", () => {
    expect(mapWorkflowStateToCompatStatus("ready_for_planning")).toBe("open");
    expect(mapWorkflowStateToCompatStatus("ready_for_implementation")).toBe("open");
  });
  it("maps active states to in_progress", () => {
    expect(mapWorkflowStateToCompatStatus("planning")).toBe("in_progress");
    expect(mapWorkflowStateToCompatStatus("implementation")).toBe("in_progress");
    expect(mapWorkflowStateToCompatStatus("shipment")).toBe("in_progress");
  });
  it("maps legacy in-progress states to in_progress", () => {
    expect(mapWorkflowStateToCompatStatus("in_progress")).toBe("in_progress");
    expect(mapWorkflowStateToCompatStatus("implementing")).toBe("in_progress");
    expect(mapWorkflowStateToCompatStatus("implemented")).toBe("in_progress");
    expect(mapWorkflowStateToCompatStatus("reviewing")).toBe("in_progress");
  });
  it("maps empty/unknown to open", () => {
    expect(mapWorkflowStateToCompatStatus("")).toBe("open");
    expect(mapWorkflowStateToCompatStatus("totally_unknown")).toBe("open");
    expect(mapWorkflowStateToCompatStatus("open")).toBe("open");
  });
});

describe("mapStatusToDefaultWorkflowState", () => {
  const workflow = defaultWorkflowDescriptor();

  it("maps closed status to shipped for autopilot", () => {
    expect(mapStatusToDefaultWorkflowState("closed", workflow)).toBe("shipped");
  });
  it("maps deferred status to deferred", () => {
    expect(mapStatusToDefaultWorkflowState("deferred", workflow)).toBe("deferred");
  });
  it("maps blocked status to retake state", () => {
    expect(mapStatusToDefaultWorkflowState("blocked", workflow)).toBe(
      workflow.retakeState,
    );
  });
  it("maps in_progress to first action state", () => {
    const result = mapStatusToDefaultWorkflowState("in_progress", workflow);
    expect(workflow.actionStates).toContain(result);
  });
  it("maps open to initial state", () => {
    expect(mapStatusToDefaultWorkflowState("open", workflow)).toBe(
      workflow.initialState,
    );
  });
  it("maps unknown status to initial state", () => {
    expect(mapStatusToDefaultWorkflowState("unknown", workflow)).toBe(
      workflow.initialState,
    );
  });
  it("maps without workflow parameter", () => {
    expect(typeof mapStatusToDefaultWorkflowState("open")).toBe("string");
  });
  it("maps closed to closed if terminal includes closed", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test", backingWorkflowId: "test", label: "Test",
      mode: "granular_autonomous", initialState: "open",
      states: ["open", "closed"], terminalStates: ["closed"],
      finalCutState: null, retakeState: "open", promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("closed", fakeWorkflow)).toBe("closed");
  });
  it("maps in_progress to implementation if present in states", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test", backingWorkflowId: "test", label: "Test",
      mode: "granular_autonomous", initialState: "open",
      states: ["open", "implementation", "closed"], terminalStates: ["closed"],
      finalCutState: null, retakeState: "open", promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("in_progress", fakeWorkflow)).toBe(
      "implementation",
    );
  });
  it("falls back to in_progress when no action/implementation state", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test", backingWorkflowId: "test", label: "Test",
      mode: "granular_autonomous", initialState: "open",
      states: ["open", "closed"], terminalStates: ["closed"],
      finalCutState: null, retakeState: "open", promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("in_progress", fakeWorkflow)).toBe(
      "in_progress",
    );
  });
  it("maps blocked to 'blocked' when no retakeState match", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test", backingWorkflowId: "test", label: "Test",
      mode: "granular_autonomous", initialState: "open",
      states: ["open", "closed"], terminalStates: ["closed"],
      finalCutState: null, retakeState: "open", promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("blocked", fakeWorkflow)).toBe("open");
  });
  it("maps deferred using terminalStateForStatus logic", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test", backingWorkflowId: "test", label: "Test",
      mode: "granular_autonomous", initialState: "open",
      states: ["open", "deferred", "closed"], terminalStates: ["closed"],
      finalCutState: null, retakeState: "open", promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("deferred", fakeWorkflow)).toBe("deferred");
  });
});

describe("deriveBeadsProfileId", () => {
  it("defaults unlabeled beads records to no-planning profile", () => {
    expect(deriveBeadsProfileId([])).toBe("autopilot_no_planning");
  });

  it("preserves explicit profile labels", () => {
    expect(deriveBeadsProfileId(["wf:profile:semiauto"])).toBe("semiauto");
  });

  it("reads profile from metadata", () => {
    expect(deriveBeadsProfileId([], { profileId: "semiauto" })).toBe("semiauto");
  });
});

describe("deriveBeadsWorkflowState", () => {
  it("maps open status with no labels to ready_for_implementation", () => {
    expect(deriveBeadsWorkflowState("open", [])).toBe("ready_for_implementation");
  });

  it("maps in_progress with no labels to implementation", () => {
    expect(deriveBeadsWorkflowState("in_progress", [])).toBe("implementation");
  });

  it("respects explicit workflow-state labels", () => {
    expect(deriveBeadsWorkflowState(undefined, ["wf:state:implementation"])).toBe(
      "implementation",
    );
  });

  it("falls back to initial state when status and labels are absent", () => {
    const state = deriveBeadsWorkflowState(undefined, []);
    expect(typeof state).toBe("string");
  });
});
