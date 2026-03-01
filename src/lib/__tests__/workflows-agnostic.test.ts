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

    it("deprecated alias returns same result", () => {
      const labels = ["wf:profile:semiauto"];
      expect(deriveProfileId(labels)).toBe(deriveBeadsProfileId(labels));
    });
  });

  describe("deriveWorkflowState", () => {
    it("returns initial state for open status with no labels", () => {
      const state = deriveWorkflowState("open", []);
      expect(state).toBe("ready_for_planning");
    });

    it("extracts state from workflow labels", () => {
      const state = deriveWorkflowState(undefined, ["wf:state:implementation"]);
      expect(state).toBe("implementation");
    });

    it("deprecated alias returns same result", () => {
      const labels = ["wf:state:implementation"];
      expect(deriveWorkflowState(undefined, labels)).toBe(
        deriveBeadsWorkflowState(undefined, labels),
      );
    });
  });

  describe("descriptor labels are backend-agnostic", () => {
    it("builtin descriptors do not contain 'Beads' in label", () => {
      const descriptors = builtinWorkflowDescriptors();
      for (const d of descriptors) {
        expect(d.label).not.toContain("Beads");
      }
    });

    it("builtin descriptors use 'Workflow' label prefix", () => {
      const descriptors = builtinWorkflowDescriptors();
      for (const d of descriptors) {
        expect(d.label).toMatch(/^Workflow \(/);
      }
    });
  });
});
