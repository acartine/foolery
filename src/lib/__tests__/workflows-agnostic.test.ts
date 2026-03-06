/**
 * Tests for backend-agnostic workflow API names.
 * Verifies that the new names work correctly and deprecated aliases still resolve.
 */
import { describe, expect, it } from "vitest";
import {
  // New backend-agnostic names
  DEFAULT_PROFILE_ID,
  DEFAULT_WORKFLOW_ID,
  DEFAULT_PROMPT_PROFILE_ID,
  builtinWorkflowDescriptors,
  builtinProfileDescriptor,
  defaultWorkflowDescriptor,
  deriveProfileId,
  deriveWorkflowState,
  profileDisplayName,
  // Deprecated names (should still work)
  DEFAULT_BEADS_PROFILE_ID,
  BEADS_COARSE_WORKFLOW_ID,
  BEADS_COARSE_PROMPT_PROFILE_ID,
  beadsProfileWorkflowDescriptors,
  beadsProfileDescriptor,
  beadsCoarseWorkflowDescriptor,
  deriveBeadsProfileId,
  deriveBeadsWorkflowState,
} from "@/lib/workflows";

describe("backend-agnostic workflow exports", () => {
  describe("constants", () => {
    it("DEFAULT_PROFILE_ID equals 'autopilot'", () => {
      expect(DEFAULT_PROFILE_ID).toBe("autopilot");
    });

    it("deprecated constant aliases resolve to the same value", () => {
      expect(DEFAULT_BEADS_PROFILE_ID).toBe(DEFAULT_PROFILE_ID);
      expect(BEADS_COARSE_WORKFLOW_ID).toBe(DEFAULT_WORKFLOW_ID);
      expect(BEADS_COARSE_PROMPT_PROFILE_ID).toBe(DEFAULT_PROMPT_PROFILE_ID);
    });
  });

  describe("builtinWorkflowDescriptors", () => {
    it("returns non-empty array of descriptors", () => {
      const descriptors = builtinWorkflowDescriptors();
      expect(descriptors.length).toBeGreaterThan(0);
    });

    it("includes autopilot and semiauto profiles", () => {
      const ids = builtinWorkflowDescriptors().map((d) => d.id);
      expect(ids).toContain("autopilot");
      expect(ids).toContain("semiauto");
    });

    it("deprecated alias returns same result", () => {
      const agnostic = builtinWorkflowDescriptors();
      const deprecated = beadsProfileWorkflowDescriptors();
      expect(agnostic).toEqual(deprecated);
    });
  });

  describe("builtinProfileDescriptor", () => {
    it("returns autopilot descriptor by default", () => {
      const descriptor = builtinProfileDescriptor();
      expect(descriptor.id).toBe("autopilot");
    });

    it("returns semiauto descriptor when requested", () => {
      const descriptor = builtinProfileDescriptor("semiauto");
      expect(descriptor.id).toBe("semiauto");
    });

    it("normalizes legacy profile ids", () => {
      const descriptor = builtinProfileDescriptor("beads-coarse");
      expect(descriptor.id).toBe("autopilot");
    });

    it("normalizes knots profile ids", () => {
      const descriptor = builtinProfileDescriptor("knots-granular");
      expect(descriptor.id).toBe("autopilot");
    });

    it("deprecated alias returns same result", () => {
      const agnostic = builtinProfileDescriptor("autopilot");
      const deprecated = beadsProfileDescriptor("autopilot");
      expect(agnostic).toEqual(deprecated);
    });
  });

  describe("defaultWorkflowDescriptor", () => {
    it("returns autopilot descriptor", () => {
      const descriptor = defaultWorkflowDescriptor();
      expect(descriptor.id).toBe("autopilot");
      expect(descriptor.initialState).toBe("ready_for_planning");
    });

    it("deprecated alias returns same result", () => {
      const agnostic = defaultWorkflowDescriptor();
      const deprecated = beadsCoarseWorkflowDescriptor();
      expect(agnostic).toEqual(deprecated);
    });
  });

  describe("deriveProfileId", () => {
    it("returns explicit profile from labels", () => {
      const result = deriveProfileId(["wf:profile:semiauto"]);
      expect(result).toBe("semiauto");
    });

    it("returns default when no explicit profile", () => {
      const result = deriveProfileId([]);
      expect(result).toBe("autopilot");
    });

    it("reads from metadata", () => {
      const result = deriveProfileId([], { profileId: "semiauto" });
      expect(result).toBe("semiauto");
    });

    it("beads alias defaults unlabeled items to no-planning profile", () => {
      expect(deriveBeadsProfileId([])).toBe("autopilot_no_planning");
    });

    it("beads alias preserves explicit profile labels", () => {
      const labels = ["wf:profile:semiauto"];
      expect(deriveBeadsProfileId(labels)).toBe("semiauto");
    });
  });

  describe("profileDisplayName", () => {
    it("normalizes legacy display aliases", () => {
      expect(profileDisplayName("automatic")).toBe("Autopilot");
      expect(profileDisplayName("workflow")).toBe("Semiauto");
    });
  });

  describe("deriveWorkflowState", () => {
    it("returns initial state for open status with no labels", () => {
      const state = deriveWorkflowState("open", []);
      expect(state).toBe("ready_for_planning");
    });

    it("beads alias maps open status with no labels to implementation queue", () => {
      const state = deriveBeadsWorkflowState("open", []);
      expect(state).toBe("ready_for_implementation");
    });

    it("beads alias maps in_progress with no labels to implementation", () => {
      const state = deriveBeadsWorkflowState("in_progress", []);
      expect(state).toBe("implementation");
    });

    it("extracts state from workflow labels", () => {
      const state = deriveWorkflowState(undefined, ["wf:state:implementation"]);
      expect(state).toBe("implementation");
    });

    it("beads alias respects explicit workflow labels", () => {
      const labels = ["wf:state:implementation"];
      expect(deriveBeadsWorkflowState(undefined, labels)).toBe("implementation");
    });
  });

  describe("descriptor labels are backend-agnostic", () => {
    it("builtin descriptors do not contain 'Beats' in label", () => {
      const descriptors = builtinWorkflowDescriptors();
      for (const d of descriptors) {
        expect(d.label).not.toContain("Beats");
      }
    });

    it("builtin descriptors use human-friendly display names", () => {
      const descriptors = builtinWorkflowDescriptors();
      for (const d of descriptors) {
        expect(d.label).not.toContain("Knots");
        expect(d.label).not.toContain("Workflow (");
        expect(d.label.length).toBeGreaterThan(0);
      }
    });
  });
});
