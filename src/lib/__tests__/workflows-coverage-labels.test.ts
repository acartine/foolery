/**
 * Coverage tests for workflows.ts label helpers, state mapping,
 * and normalization functions.
 */
import { describe, expect, it } from "vitest";
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import {
  defaultWorkflowDescriptor,
  isWorkflowStateLabel,
  isWorkflowProfileLabel,
  extractWorkflowStateLabel,
  extractWorkflowProfileLabel,
  withWorkflowStateLabel,
  withWorkflowProfileLabel,
  mapWorkflowStateToCompatStatus,
  mapStatusToDefaultWorkflowState,
  normalizeStateForWorkflow,
} from "@/lib/workflows";

describe("isWorkflowStateLabel", () => {
  it("returns true for state labels", () => {
    expect(isWorkflowStateLabel("wf:state:planning")).toBe(true);
  });
  it("returns false for non-state labels", () => {
    expect(isWorkflowStateLabel("wf:profile:autopilot")).toBe(false);
    expect(isWorkflowStateLabel("some-label")).toBe(false);
  });
});

describe("isWorkflowProfileLabel", () => {
  it("returns true for profile labels", () => {
    expect(isWorkflowProfileLabel("wf:profile:autopilot")).toBe(true);
  });
  it("returns false for non-profile labels", () => {
    expect(isWorkflowProfileLabel("wf:state:planning")).toBe(false);
  });
});

describe("extractWorkflowStateLabel", () => {
  it("extracts state from labels", () => {
    expect(extractWorkflowStateLabel(["wf:state:implementation"])).toBe("implementation");
  });
  it("returns null when no state label present", () => {
    expect(extractWorkflowStateLabel(["other-label"])).toBeNull();
  });
  it("returns null for empty labels", () => {
    expect(extractWorkflowStateLabel([])).toBeNull();
  });
  it("skips empty-value state labels", () => {
    expect(extractWorkflowStateLabel(["wf:state:", "wf:state:planning"])).toBe("planning");
  });
  it("returns first valid state label", () => {
    expect(
      extractWorkflowStateLabel(["wf:state:shipment", "wf:state:planning"]),
    ).toBe("shipment");
  });
});

describe("extractWorkflowProfileLabel", () => {
  it("extracts profile from labels", () => {
    expect(extractWorkflowProfileLabel(["wf:profile:semiauto"])).toBe("semiauto");
  });
  it("normalizes legacy profile ids from labels", () => {
    expect(extractWorkflowProfileLabel(["wf:profile:beads-coarse"])).toBe("autopilot");
    expect(extractWorkflowProfileLabel(["wf:profile:automatic"])).toBe("autopilot");
    expect(extractWorkflowProfileLabel(["wf:profile:knots-granular"])).toBe("autopilot");
    expect(extractWorkflowProfileLabel(["wf:profile:workflow"])).toBe("semiauto");
    expect(extractWorkflowProfileLabel(["wf:profile:knots-coarse"])).toBe("semiauto");
    expect(
      extractWorkflowProfileLabel(["wf:profile:beads-coarse-human-gated"]),
    ).toBe("semiauto");
    expect(
      extractWorkflowProfileLabel(["wf:profile:knots-granular-autonomous"]),
    ).toBe("autopilot");
    expect(
      extractWorkflowProfileLabel(["wf:profile:knots-coarse-human-gated"]),
    ).toBe("semiauto");
  });
  it("returns null when no profile label present", () => {
    expect(extractWorkflowProfileLabel(["wf:state:planning"])).toBeNull();
  });
  it("skips empty-value profile labels", () => {
    expect(
      extractWorkflowProfileLabel(["wf:profile:", "wf:profile:semiauto"]),
    ).toBe("semiauto");
  });
});

describe("withWorkflowStateLabel", () => {
  it("adds state label and removes old ones", () => {
    const result = withWorkflowStateLabel(["wf:state:old", "other"], "planning");
    expect(result).toContain("wf:state:planning");
    expect(result).toContain("other");
    expect(result).not.toContain("wf:state:old");
  });
  it("normalizes empty state to open", () => {
    const result = withWorkflowStateLabel([], "");
    expect(result).toContain("wf:state:open");
  });
  it("deduplicates labels", () => {
    const result = withWorkflowStateLabel(["other", "other"], "planning");
    const otherCount = result.filter((l) => l === "other").length;
    expect(otherCount).toBe(1);
  });
});

describe("withWorkflowProfileLabel", () => {
  it("adds profile label and removes old ones", () => {
    const result = withWorkflowProfileLabel(
      ["wf:profile:old", "other"],
      "semiauto",
    );
    expect(result).toContain("wf:profile:semiauto");
    expect(result).toContain("other");
    expect(result).not.toContain("wf:profile:old");
  });
  it("normalizes empty profile to default", () => {
    const result = withWorkflowProfileLabel([], "");
    expect(result).toContain("wf:profile:autopilot");
  });
});

describe("mapWorkflowStateToCompatStatus", () => {
  it("maps deferred to deferred", () => {
    expect(mapWorkflowStateToCompatStatus("deferred")).toBe("deferred");
  });
  it("maps blocked to blocked", () => {
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
  it("maps empty/null to open", () => {
    expect(mapWorkflowStateToCompatStatus("")).toBe("open");
  });
  it("maps 'open' to open", () => {
    expect(mapWorkflowStateToCompatStatus("open")).toBe("open");
  });
  it("maps unknown states to open", () => {
    expect(mapWorkflowStateToCompatStatus("totally_unknown")).toBe("open");
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
    const result = mapStatusToDefaultWorkflowState("open");
    expect(typeof result).toBe("string");
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
  it("maps blocked to 'blocked' if no retakeState", () => {
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

describe("normalizeStateForWorkflow", () => {
  const workflow = defaultWorkflowDescriptor();

  it("returns initial state for undefined input", () => {
    expect(normalizeStateForWorkflow(undefined, workflow)).toBe(workflow.initialState);
  });
  it("returns initial state for empty string", () => {
    expect(normalizeStateForWorkflow("", workflow)).toBe(workflow.initialState);
  });
  it("passes through valid workflow states", () => {
    expect(normalizeStateForWorkflow("implementation", workflow)).toBe("implementation");
  });
  it("remaps legacy open state to initial state", () => {
    expect(normalizeStateForWorkflow("open", workflow)).toBe(workflow.initialState);
    expect(normalizeStateForWorkflow("idea", workflow)).toBe(workflow.initialState);
    expect(normalizeStateForWorkflow("work_item", workflow)).toBe(workflow.initialState);
  });
  it("remaps legacy in_progress states to first action state", () => {
    const result = normalizeStateForWorkflow("in_progress", workflow);
    expect(workflow.actionStates).toContain(result);
  });
  it("remaps impl shorthand state to implementation", () => {
    expect(normalizeStateForWorkflow("impl", workflow)).toBe("implementation");
    expect(normalizeStateForWorkflow("  ImPl  ", workflow)).toBe("implementation");
  });
  it("remaps reviewing to implementation_review queue", () => {
    expect(normalizeStateForWorkflow("ready_for_review", workflow)).toBe(
      "ready_for_implementation_review",
    );
  });
  it("remaps legacy retake states", () => {
    const result = normalizeStateForWorkflow("retake", workflow);
    expect(result).toBe(workflow.retakeState);
    expect(normalizeStateForWorkflow("retry", workflow)).toBe(workflow.retakeState);
    expect(normalizeStateForWorkflow("rejected", workflow)).toBe(workflow.retakeState);
    expect(normalizeStateForWorkflow("refining", workflow)).toBe(workflow.retakeState);
    expect(normalizeStateForWorkflow("rework", workflow)).toBe(workflow.retakeState);
  });
  it("remaps legacy terminal states", () => {
    expect(normalizeStateForWorkflow("closed", workflow)).toBe("shipped");
    expect(normalizeStateForWorkflow("done", workflow)).toBe("shipped");
    expect(normalizeStateForWorkflow("approved", workflow)).toBe("shipped");
  });
  it("preserves explicit shipped/abandoned states even when omitted", () => {
    const limitedWorkflow: MemoryWorkflowDescriptor = {
      ...workflow,
      states: workflow.states.filter(
        (state) => state !== "shipped" && state !== "abandoned",
      ),
      terminalStates: ["shipped"],
    };
    expect(normalizeStateForWorkflow("shipped", limitedWorkflow)).toBe("shipped");
    expect(normalizeStateForWorkflow("abandoned", limitedWorkflow)).toBe("abandoned");
  });
  it("remaps deferred state", () => {
    expect(normalizeStateForWorkflow("deferred", workflow)).toBe("deferred");
  });
  it("returns initial state for unknown legacy states", () => {
    expect(normalizeStateForWorkflow("totally_unknown", workflow)).toBe(
      workflow.initialState,
    );
  });
  it("handles case normalization", () => {
    expect(normalizeStateForWorkflow("  IMPLEMENTATION  ", workflow)).toBe(
      "implementation",
    );
  });
});
