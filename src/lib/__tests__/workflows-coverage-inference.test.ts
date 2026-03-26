/**
 * Coverage tests for workflows.ts inference, descriptor, beat helper,
 * and runtime state functions.
 */
import { describe, expect, it } from "vitest";
import type { Beat } from "@/lib/types";
import {
  builtinWorkflowDescriptors,
  builtinProfileDescriptor,
  defaultWorkflowDescriptor,
  deriveProfileId,
  deriveBeadsWorkflowState,
  deriveWorkflowState,
  deriveWorkflowRuntimeState,
  inferWorkflowMode,
  inferFinalCutState,
  inferRetakeState,
  workflowDescriptorById,
  beatRequiresHumanAction,
  beatInFinalCut,
  beatInRetake,
  isRollbackTransition,
} from "@/lib/workflows";

describe("inferWorkflowMode", () => {
  it("returns coarse_human_gated for semiauto hints", () => {
    expect(inferWorkflowMode("semiauto-flow")).toBe("coarse_human_gated");
  });
  it("returns coarse_human_gated for coarse hints", () => {
    expect(inferWorkflowMode("some-coarse-id")).toBe("coarse_human_gated");
  });
  it("returns coarse_human_gated for human-gated hints", () => {
    expect(inferWorkflowMode("custom", "human gated flow")).toBe("coarse_human_gated");
  });
  it("returns coarse_human_gated for PR hints", () => {
    expect(inferWorkflowMode("custom", "pull request output")).toBe(
      "coarse_human_gated",
    );
    expect(inferWorkflowMode("custom", null, ["pr"])).toBe("coarse_human_gated");
  });
  it("returns granular_autonomous for non-matching hints", () => {
    expect(inferWorkflowMode("autopilot")).toBe("granular_autonomous");
    expect(inferWorkflowMode("custom", "agent-owned flow")).toBe("granular_autonomous");
  });
  it("handles null description", () => {
    expect(inferWorkflowMode("autopilot", null)).toBe("granular_autonomous");
  });
  it("handles undefined states", () => {
    expect(inferWorkflowMode("autopilot", null, undefined)).toBe("granular_autonomous");
  });
});

describe("inferFinalCutState", () => {
  it("prefers ready_for_plan_review", () => {
    expect(
      inferFinalCutState(["ready_for_plan_review", "ready_for_implementation_review"]),
    ).toBe("ready_for_plan_review");
  });
  it("returns ready_for_implementation_review as second choice", () => {
    expect(
      inferFinalCutState(["ready_for_implementation_review", "ready_for_shipment_review"]),
    ).toBe("ready_for_implementation_review");
  });
  it("returns ready_for_shipment_review as third choice", () => {
    expect(inferFinalCutState(["ready_for_shipment_review"])).toBe(
      "ready_for_shipment_review",
    );
  });
  it("returns reviewing as fourth choice", () => {
    expect(inferFinalCutState(["reviewing"])).toBe("reviewing");
  });
  it("returns null when no preferred states present", () => {
    expect(inferFinalCutState(["open", "closed"])).toBeNull();
  });
  it("returns null for empty array", () => {
    expect(inferFinalCutState([])).toBeNull();
  });
});

describe("inferRetakeState", () => {
  it("prefers ready_for_implementation", () => {
    expect(inferRetakeState(["ready_for_implementation", "retake"], "open")).toBe(
      "ready_for_implementation",
    );
  });
  it("returns retake as second choice", () => {
    expect(inferRetakeState(["retake", "retry"], "open")).toBe("retake");
  });
  it("returns retry as third choice", () => {
    expect(inferRetakeState(["retry", "rejected"], "open")).toBe("retry");
  });
  it("returns rejected as fourth choice", () => {
    expect(inferRetakeState(["rejected", "refining"], "open")).toBe("rejected");
  });
  it("returns refining as fifth choice", () => {
    expect(inferRetakeState(["refining"], "open")).toBe("refining");
  });
  it("falls back to initialState", () => {
    expect(inferRetakeState(["open", "closed"], "open")).toBe("open");
  });
});

describe("workflowDescriptorById", () => {
  it("builds a map from workflow descriptors", () => {
    const descriptors = builtinWorkflowDescriptors();
    const map = workflowDescriptorById(descriptors);
    expect(map.get("autopilot")).toBeDefined();
    expect(map.get("semiauto")).toBeDefined();
  });

  it("registers legacy aliases for autopilot", () => {
    const descriptors = builtinWorkflowDescriptors();
    const map = workflowDescriptorById(descriptors);
    expect(map.get("beads-coarse")).toBe(map.get("autopilot"));
    expect(map.get("knots-granular")).toBe(map.get("autopilot"));
    expect(map.get("knots-granular-autonomous")).toBe(map.get("autopilot"));
  });

  it("registers legacy aliases for semiauto", () => {
    const descriptors = builtinWorkflowDescriptors();
    const map = workflowDescriptorById(descriptors);
    expect(map.get("knots-coarse")).toBe(map.get("semiauto"));
    expect(map.get("knots-coarse-human-gated")).toBe(map.get("semiauto"));
    expect(map.get("beads-coarse-human-gated")).toBe(map.get("semiauto"));
  });

  it("registers by backingWorkflowId and profileId", () => {
    const descriptors = builtinWorkflowDescriptors();
    const map = workflowDescriptorById(descriptors);
    for (const d of descriptors) {
      expect(map.get(d.backingWorkflowId)).toBeDefined();
      if (d.profileId) expect(map.get(d.profileId)).toBeDefined();
    }
  });
});

describe("beatRequiresHumanAction", () => {
  const descriptors = builtinWorkflowDescriptors();
  const workflowsById = workflowDescriptorById(descriptors);

  it("returns true if beat.requiresHumanAction is true", () => {
    const beat: Beat = {
      id: "test-1", title: "Test", state: "plan_review", priority: 2,
      type: "task", labels: [], created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z", requiresHumanAction: true,
      profileId: "autopilot",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(true);
  });

  it("returns false if beat.requiresHumanAction is false", () => {
    const beat: Beat = {
      id: "test-2", title: "Test", state: "planning", priority: 2,
      type: "task", labels: [], created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z", requiresHumanAction: false,
      profileId: "semiauto",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(false);
  });

  it("derives from workflow when requiresHumanAction not set", () => {
    const beat: Beat = {
      id: "test-3", title: "Test", state: "plan_review", priority: 2,
      type: "task", labels: [], created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z", profileId: "semiauto",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(true);
  });

  it("returns false when workflow not found and no explicit flag", () => {
    const beat: Beat = {
      id: "test-4", title: "Test", state: "planning", priority: 2,
      type: "task", labels: [], created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z", profileId: "nonexistent-profile",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(false);
  });

  it("resolves workflow by workflowId when profileId missing", () => {
    const beat: Beat = {
      id: "test-5", title: "Test", state: "plan_review", priority: 2,
      type: "task", labels: [], created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z", workflowId: "semiauto",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(true);
  });
});

describe("beatInFinalCut", () => {
  const descriptors = builtinWorkflowDescriptors();
  const workflowsById = workflowDescriptorById(descriptors);

  it("delegates to beatRequiresHumanAction", () => {
    const beat: Beat = {
      id: "test-fc", title: "Test", state: "plan_review", priority: 2,
      type: "task", labels: [], created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z", profileId: "semiauto",
    };
    expect(beatInFinalCut(beat, workflowsById)).toBe(
      beatRequiresHumanAction(beat, workflowsById),
    );
  });
});

describe("beatInRetake", () => {
  const descriptors = builtinWorkflowDescriptors();
  const workflowsById = workflowDescriptorById(descriptors);

  it("returns true for legacy retake states", () => {
    const retakeStates = ["retake", "retry", "rejected", "refining", "rework"];
    for (const state of retakeStates) {
      const beat: Beat = {
        id: "test-retake", title: "Test", state, priority: 2,
        type: "task", labels: [], created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z", profileId: "autopilot",
      };
      expect(beatInRetake(beat, workflowsById)).toBe(true);
    }
  });

  it("returns true when state matches workflow retake state", () => {
    const workflow = builtinProfileDescriptor("autopilot");
    const beat: Beat = {
      id: "test-retake2", title: "Test", state: workflow.retakeState,
      priority: 2, type: "task", labels: [],
      created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z",
      profileId: "autopilot",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(true);
  });

  it("returns false when workflow not found and not in legacy retake", () => {
    const beat: Beat = {
      id: "test-retake3", title: "Test", state: "implementation",
      priority: 2, type: "task", labels: [],
      created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z",
      profileId: "nonexistent",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(false);
  });

  it("returns false for non-retake active state", () => {
    const beat: Beat = {
      id: "test-retake4", title: "Test", state: "planning",
      priority: 2, type: "task", labels: [],
      created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z",
      profileId: "autopilot",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(false);
  });

  it("handles null/empty state", () => {
    const beat: Beat = {
      id: "test-retake5", title: "Test", state: "",
      priority: 2, type: "task", labels: [],
      created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z",
      profileId: "autopilot",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(false);
  });
});

describe("deriveWorkflowRuntimeState", () => {
  const workflow = defaultWorkflowDescriptor();

  it("derives runtime state for queue state", () => {
    const runtime = deriveWorkflowRuntimeState(workflow, "ready_for_planning");
    expect(runtime.state).toBe("ready_for_planning");
    expect(runtime.compatStatus).toBe("open");
    expect(runtime.nextActionOwnerKind).toBe("agent");
    expect(runtime.requiresHumanAction).toBe(false);
    expect(runtime.isAgentClaimable).toBe(true);
  });

  it("derives runtime state for active state", () => {
    const runtime = deriveWorkflowRuntimeState(workflow, "implementation");
    expect(runtime.state).toBe("implementation");
    expect(runtime.compatStatus).toBe("in_progress");
    expect(runtime.isAgentClaimable).toBe(false);
  });

  it("derives runtime state for terminal state", () => {
    const runtime = deriveWorkflowRuntimeState(workflow, "shipped");
    expect(runtime.state).toBe("shipped");
    expect(runtime.compatStatus).toBe("closed");
    expect(runtime.nextActionOwnerKind).toBe("none");
  });

  it("derives runtime state for semiauto human-owned step", () => {
    const semiauto = builtinProfileDescriptor("semiauto");
    const runtime = deriveWorkflowRuntimeState(semiauto, "ready_for_plan_review");
    expect(runtime.state).toBe("ready_for_plan_review");
    expect(runtime.requiresHumanAction).toBe(true);
    expect(runtime.isAgentClaimable).toBe(false);
  });

  it("normalizes undefined state to initial", () => {
    const runtime = deriveWorkflowRuntimeState(workflow, undefined);
    expect(runtime.state).toBe(workflow.initialState);
  });
});

describe("deriveProfileId metadata paths", () => {
  it("reads fooleryProfileId from metadata", () => {
    expect(deriveProfileId([], { fooleryProfileId: "semiauto" })).toBe("semiauto");
  });
  it("reads workflowProfileId from metadata", () => {
    expect(deriveProfileId([], { workflowProfileId: "semiauto" })).toBe("semiauto");
  });
  it("reads knotsProfileId from metadata", () => {
    expect(deriveProfileId([], { knotsProfileId: "semiauto" })).toBe("semiauto");
  });
  it("prefers profileId over other metadata keys", () => {
    expect(
      deriveProfileId([], { profileId: "autopilot", fooleryProfileId: "semiauto" }),
    ).toBe("autopilot");
  });
  it("skips empty string metadata", () => {
    expect(
      deriveProfileId([], { profileId: "", fooleryProfileId: "semiauto" }),
    ).toBe("semiauto");
  });
  it("returns default when metadata has only whitespace values", () => {
    expect(deriveProfileId([], { profileId: "   " })).toBe("autopilot");
  });
  it("prefers metadata over labels", () => {
    expect(
      deriveProfileId(["wf:profile:semiauto"], { profileId: "autopilot" }),
    ).toBe("autopilot");
  });
  it("falls back to labels when metadata is undefined", () => {
    expect(deriveProfileId(["wf:profile:semiauto"])).toBe("semiauto");
  });
  it("returns default when labels and metadata are both absent", () => {
    expect(deriveProfileId(undefined)).toBe("autopilot");
  });
});

describe("deriveWorkflowState additional branches", () => {
  it("falls back to status when no label match", () => {
    const state = deriveWorkflowState("in_progress", []);
    expect(typeof state).toBe("string");
  });
  it("returns initial state when no status or labels", () => {
    const workflow = defaultWorkflowDescriptor();
    const state = deriveWorkflowState(undefined, [], workflow);
    expect(state).toBe(workflow.initialState);
  });
  it("maps unlabeled beads open status to implementation queue", () => {
    expect(deriveBeadsWorkflowState("open", [])).toBe("ready_for_implementation");
  });
  it("maps unlabeled beads in_progress status to implementation", () => {
    expect(deriveBeadsWorkflowState("in_progress", [])).toBe("implementation");
  });
});

describe("builtin profile descriptors edge cases", () => {
  it("no-planning profiles start at ready_for_implementation", () => {
    const desc = builtinProfileDescriptor("autopilot_no_planning");
    expect(desc.initialState).toBe("ready_for_implementation");
    expect(desc.states).not.toContain("ready_for_planning");
    expect(desc.states).not.toContain("planning");
  });

  it("PR profiles exist", () => {
    const desc = builtinProfileDescriptor("autopilot_with_pr");
    expect(desc.id).toBe("autopilot_with_pr");
  });

  it("semiauto_no_planning profile works", () => {
    const desc = builtinProfileDescriptor("semiauto_no_planning");
    expect(desc.initialState).toBe("ready_for_implementation");
    expect(desc.mode).toBe("coarse_human_gated");
  });

  it("falls back to default for completely unknown profile", () => {
    const desc = builtinProfileDescriptor("completely-unknown-profile-xyz");
    expect(desc.id).toBe("autopilot");
  });

  it("cloneWorkflowDescriptor returns independent copy", () => {
    const desc1 = builtinProfileDescriptor("autopilot");
    const desc2 = builtinProfileDescriptor("autopilot");
    desc1.states.push("custom_state");
    expect(desc2.states).not.toContain("custom_state");
  });
});

describe("isRollbackTransition", () => {
  it("returns true for backward transitions", () => {
    expect(isRollbackTransition("plan_review", "ready_for_planning")).toBe(true);
    expect(
      isRollbackTransition("implementation_review", "ready_for_implementation"),
    ).toBe(true);
    expect(
      isRollbackTransition("shipment_review", "ready_for_implementation"),
    ).toBe(true);
    expect(isRollbackTransition("shipment_review", "ready_for_shipment")).toBe(true);
  });

  it("returns false for forward transitions", () => {
    expect(isRollbackTransition("ready_for_planning", "planning")).toBe(false);
    expect(isRollbackTransition("planning", "ready_for_plan_review")).toBe(false);
    expect(
      isRollbackTransition("implementation", "ready_for_implementation_review"),
    ).toBe(false);
    expect(isRollbackTransition("shipment_review", "shipped")).toBe(false);
  });

  it("returns false for same-state transitions", () => {
    expect(isRollbackTransition("planning", "planning")).toBe(false);
  });

  it("returns false for unknown states", () => {
    expect(isRollbackTransition("unknown", "planning")).toBe(false);
    expect(isRollbackTransition("planning", "unknown")).toBe(false);
    expect(isRollbackTransition("deferred", "planning")).toBe(false);
  });
});
