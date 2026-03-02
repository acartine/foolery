/**
 * Additional coverage tests for src/lib/workflows.ts.
 * Targets uncovered lines: 41, 605, 611-695.
 */
import { describe, expect, it } from "vitest";
import type { Beat, MemoryWorkflowDescriptor, MemoryWorkflowOwners } from "@/lib/types";
import {
  builtinWorkflowDescriptors,
  builtinProfileDescriptor,
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
  deriveProfileId,
  deriveWorkflowState,
  deriveWorkflowRuntimeState,
  inferWorkflowMode,
  inferFinalCutState,
  inferRetakeState,
  workflowDescriptorById,
  beatRequiresHumanAction,
  beatInFinalCut,
  beatInRetake,
  WF_STATE_LABEL_PREFIX,
  WF_PROFILE_LABEL_PREFIX,
} from "@/lib/workflows";

// ── Label helpers coverage ──────────────────────────────────

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
    expect(extractWorkflowStateLabel(["wf:state:shipment", "wf:state:planning"])).toBe("shipment");
  });
});

describe("extractWorkflowProfileLabel", () => {
  it("extracts profile from labels", () => {
    expect(extractWorkflowProfileLabel(["wf:profile:semiauto"])).toBe("semiauto");
  });
  it("normalizes legacy profile ids from labels", () => {
    expect(extractWorkflowProfileLabel(["wf:profile:beads-coarse"])).toBe("autopilot");
    expect(extractWorkflowProfileLabel(["wf:profile:knots-granular"])).toBe("autopilot");
    expect(extractWorkflowProfileLabel(["wf:profile:knots-coarse"])).toBe("semiauto");
    expect(extractWorkflowProfileLabel(["wf:profile:beads-coarse-human-gated"])).toBe("semiauto");
    expect(extractWorkflowProfileLabel(["wf:profile:knots-granular-autonomous"])).toBe("autopilot");
    expect(extractWorkflowProfileLabel(["wf:profile:knots-coarse-human-gated"])).toBe("semiauto");
  });
  it("returns null when no profile label present", () => {
    expect(extractWorkflowProfileLabel(["wf:state:planning"])).toBeNull();
  });
  it("skips empty-value profile labels", () => {
    expect(extractWorkflowProfileLabel(["wf:profile:", "wf:profile:semiauto"])).toBe("semiauto");
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
    const result = withWorkflowProfileLabel(["wf:profile:old", "other"], "semiauto");
    expect(result).toContain("wf:profile:semiauto");
    expect(result).toContain("other");
    expect(result).not.toContain("wf:profile:old");
  });
  it("normalizes empty profile to default", () => {
    const result = withWorkflowProfileLabel([], "");
    expect(result).toContain("wf:profile:autopilot");
  });
});

// ── mapWorkflowStateToCompatStatus coverage ─────────────────

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

// ── mapStatusToDefaultWorkflowState coverage ────────────────

describe("mapStatusToDefaultWorkflowState", () => {
  const workflow = defaultWorkflowDescriptor();

  it("maps closed status to shipped for autopilot", () => {
    expect(mapStatusToDefaultWorkflowState("closed", workflow)).toBe("shipped");
  });
  it("maps deferred status to deferred", () => {
    expect(mapStatusToDefaultWorkflowState("deferred", workflow)).toBe("deferred");
  });
  it("maps blocked status to retake state", () => {
    expect(mapStatusToDefaultWorkflowState("blocked", workflow)).toBe(workflow.retakeState);
  });
  it("maps in_progress to first action state", () => {
    const result = mapStatusToDefaultWorkflowState("in_progress", workflow);
    expect(workflow.actionStates).toContain(result);
  });
  it("maps open to initial state", () => {
    expect(mapStatusToDefaultWorkflowState("open", workflow)).toBe(workflow.initialState);
  });
  it("maps unknown status to initial state", () => {
    expect(mapStatusToDefaultWorkflowState("unknown", workflow)).toBe(workflow.initialState);
  });
  it("maps without workflow parameter", () => {
    const result = mapStatusToDefaultWorkflowState("open");
    expect(typeof result).toBe("string");
  });
  it("maps closed to closed if terminal includes closed", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test",
      backingWorkflowId: "test",
      label: "Test",
      mode: "granular_autonomous",
      initialState: "open",
      states: ["open", "closed"],
      terminalStates: ["closed"],
      finalCutState: null,
      retakeState: "open",
      promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("closed", fakeWorkflow)).toBe("closed");
  });
  it("maps in_progress to implementation if present in states", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test",
      backingWorkflowId: "test",
      label: "Test",
      mode: "granular_autonomous",
      initialState: "open",
      states: ["open", "implementation", "closed"],
      terminalStates: ["closed"],
      finalCutState: null,
      retakeState: "open",
      promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("in_progress", fakeWorkflow)).toBe("implementation");
  });
  it("falls back to in_progress when no action/implementation state", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test",
      backingWorkflowId: "test",
      label: "Test",
      mode: "granular_autonomous",
      initialState: "open",
      states: ["open", "closed"],
      terminalStates: ["closed"],
      finalCutState: null,
      retakeState: "open",
      promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("in_progress", fakeWorkflow)).toBe("in_progress");
  });
  it("maps blocked to 'blocked' if no retakeState", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test",
      backingWorkflowId: "test",
      label: "Test",
      mode: "granular_autonomous",
      initialState: "open",
      states: ["open", "closed"],
      terminalStates: ["closed"],
      finalCutState: null,
      retakeState: "open",
      promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("blocked", fakeWorkflow)).toBe("open");
  });
  it("maps deferred using terminalStateForStatus logic", () => {
    const fakeWorkflow: MemoryWorkflowDescriptor = {
      id: "test",
      backingWorkflowId: "test",
      label: "Test",
      mode: "granular_autonomous",
      initialState: "open",
      states: ["open", "deferred", "closed"],
      terminalStates: ["closed"],
      finalCutState: null,
      retakeState: "open",
      promptProfileId: "test",
    };
    expect(mapStatusToDefaultWorkflowState("deferred", fakeWorkflow)).toBe("deferred");
  });
});

// ── normalizeStateForWorkflow coverage ──────────────────────

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
  it("remaps verification/reviewing to implementation_review queue", () => {
    expect(normalizeStateForWorkflow("verification", workflow)).toBe("ready_for_implementation_review");
    expect(normalizeStateForWorkflow("ready_for_review", workflow)).toBe("ready_for_implementation_review");
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
  it("remaps deferred state", () => {
    expect(normalizeStateForWorkflow("deferred", workflow)).toBe("deferred");
  });
  it("returns initial state for unknown legacy states", () => {
    expect(normalizeStateForWorkflow("totally_unknown", workflow)).toBe(workflow.initialState);
  });
  it("handles case normalization", () => {
    expect(normalizeStateForWorkflow("  IMPLEMENTATION  ", workflow)).toBe("implementation");
  });
});

// ── inferWorkflowMode coverage (line 605) ───────────────────

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
    expect(inferWorkflowMode("custom", "pull request output")).toBe("coarse_human_gated");
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

// ── inferFinalCutState coverage (line 611-616) ──────────────

describe("inferFinalCutState", () => {
  it("prefers ready_for_plan_review", () => {
    expect(inferFinalCutState(["ready_for_plan_review", "ready_for_implementation_review"])).toBe(
      "ready_for_plan_review",
    );
  });
  it("returns ready_for_implementation_review as second choice", () => {
    expect(inferFinalCutState(["ready_for_implementation_review", "ready_for_shipment_review"])).toBe(
      "ready_for_implementation_review",
    );
  });
  it("returns ready_for_shipment_review as third choice", () => {
    expect(inferFinalCutState(["ready_for_shipment_review"])).toBe("ready_for_shipment_review");
  });
  it("returns verification as fourth choice", () => {
    expect(inferFinalCutState(["verification"])).toBe("verification");
  });
  it("returns reviewing as fifth choice", () => {
    expect(inferFinalCutState(["reviewing"])).toBe("reviewing");
  });
  it("returns null when no preferred states present", () => {
    expect(inferFinalCutState(["open", "closed"])).toBeNull();
  });
  it("returns null for empty array", () => {
    expect(inferFinalCutState([])).toBeNull();
  });
});

// ── inferRetakeState coverage (line 618-624) ────────────────

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

// ── workflowDescriptorById coverage (line 626-651) ─────────

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

// ── beatRequiresHumanAction coverage (line 663-671) ─────────

describe("beatRequiresHumanAction", () => {
  const descriptors = builtinWorkflowDescriptors();
  const workflowsById = workflowDescriptorById(descriptors);

  it("returns true if beat.requiresHumanAction is true", () => {
    const beat: Beat = {
      id: "test-1",
      title: "Test",
      state: "plan_review",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      requiresHumanAction: true,
      profileId: "autopilot",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(true);
  });

  it("returns false if beat.requiresHumanAction is false", () => {
    const beat: Beat = {
      id: "test-2",
      title: "Test",
      state: "planning",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      requiresHumanAction: false,
      profileId: "semiauto",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(false);
  });

  it("derives from workflow when requiresHumanAction not set", () => {
    const beat: Beat = {
      id: "test-3",
      title: "Test",
      state: "plan_review",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "semiauto",
    };
    // semiauto has human plan_review
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(true);
  });

  it("returns false when workflow not found and no explicit flag", () => {
    const beat: Beat = {
      id: "test-4",
      title: "Test",
      state: "planning",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "nonexistent-profile",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(false);
  });

  it("resolves workflow by workflowId when profileId missing", () => {
    const beat: Beat = {
      id: "test-5",
      title: "Test",
      state: "plan_review",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      workflowId: "semiauto",
    };
    expect(beatRequiresHumanAction(beat, workflowsById)).toBe(true);
  });
});

// ── beatInFinalCut coverage (line 673-678) ──────────────────

describe("beatInFinalCut", () => {
  const descriptors = builtinWorkflowDescriptors();
  const workflowsById = workflowDescriptorById(descriptors);

  it("delegates to beatRequiresHumanAction", () => {
    const beat: Beat = {
      id: "test-fc",
      title: "Test",
      state: "plan_review",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "semiauto",
    };
    expect(beatInFinalCut(beat, workflowsById)).toBe(
      beatRequiresHumanAction(beat, workflowsById),
    );
  });
});

// ── beatInRetake coverage (line 680-690) ────────────────────

describe("beatInRetake", () => {
  const descriptors = builtinWorkflowDescriptors();
  const workflowsById = workflowDescriptorById(descriptors);

  it("returns true for legacy retake states", () => {
    const retakeStates = ["retake", "retry", "rejected", "refining", "rework"];
    for (const state of retakeStates) {
      const beat: Beat = {
        id: "test-retake",
        title: "Test",
        state,
        priority: 2,
        type: "task",
        labels: [],
        created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z",
        profileId: "autopilot",
      };
      expect(beatInRetake(beat, workflowsById)).toBe(true);
    }
  });

  it("returns true when state matches workflow retake state", () => {
    const workflow = builtinProfileDescriptor("autopilot");
    const beat: Beat = {
      id: "test-retake2",
      title: "Test",
      state: workflow.retakeState,
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "autopilot",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(true);
  });

  it("returns false when workflow not found and not in legacy retake", () => {
    const beat: Beat = {
      id: "test-retake3",
      title: "Test",
      state: "implementation",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "nonexistent",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(false);
  });

  it("returns false for non-retake active state", () => {
    const beat: Beat = {
      id: "test-retake4",
      title: "Test",
      state: "planning",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "autopilot",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(false);
  });

  it("handles null/empty state", () => {
    const beat: Beat = {
      id: "test-retake5",
      title: "Test",
      state: "",
      priority: 2,
      type: "task",
      labels: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      profileId: "autopilot",
    };
    expect(beatInRetake(beat, workflowsById)).toBe(false);
  });
});

// ── deriveWorkflowRuntimeState coverage ─────────────────────

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

// ── deriveProfileId additional coverage ─────────────────────

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
    expect(deriveProfileId([], { profileId: "autopilot", fooleryProfileId: "semiauto" })).toBe("autopilot");
  });
  it("skips empty string metadata", () => {
    expect(deriveProfileId([], { profileId: "", fooleryProfileId: "semiauto" })).toBe("semiauto");
  });
  it("returns default when metadata has only whitespace values", () => {
    expect(deriveProfileId([], { profileId: "   " })).toBe("autopilot");
  });
  it("prefers metadata over labels", () => {
    expect(deriveProfileId(["wf:profile:semiauto"], { profileId: "autopilot" })).toBe("autopilot");
  });
  it("falls back to labels when metadata is undefined", () => {
    expect(deriveProfileId(["wf:profile:semiauto"])).toBe("semiauto");
  });
  it("returns default when labels and metadata are both absent", () => {
    expect(deriveProfileId(undefined)).toBe("autopilot");
  });
});

// ── deriveWorkflowState additional coverage ─────────────────

describe("deriveWorkflowState additional branches", () => {
  it("handles stage:verification label", () => {
    const state = deriveWorkflowState(undefined, ["stage:verification"]);
    expect(state).toBe("ready_for_implementation_review");
  });
  it("handles stage:retry label", () => {
    const workflow = defaultWorkflowDescriptor();
    const state = deriveWorkflowState(undefined, ["stage:retry"], workflow);
    expect(state).toBe(workflow.retakeState);
  });
  it("falls back to status when no label match", () => {
    const state = deriveWorkflowState("in_progress", []);
    expect(typeof state).toBe("string");
  });
  it("returns initial state when no status or labels", () => {
    const workflow = defaultWorkflowDescriptor();
    const state = deriveWorkflowState(undefined, [], workflow);
    expect(state).toBe(workflow.initialState);
  });
});

// ── Builtin profile descriptors edge cases ──────────────────

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
