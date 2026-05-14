import { describe, expect, it } from "vitest";
import { resolveDefaultProfile } from "@/lib/profile-defaults";
import type { MemoryWorkflowDescriptor } from "@/lib/types";

function makeDescriptor(
  id: string,
  overrides: Partial<MemoryWorkflowDescriptor> = {},
): MemoryWorkflowDescriptor {
  return {
    id,
    backingWorkflowId: id,
    label: id,
    mode: "granular_autonomous",
    initialState: "ready_for_implementation",
    states: ["ready_for_implementation", "implementation", "shipped"],
    terminalStates: ["shipped"],
    finalCutState: null,
    retakeState: "ready_for_implementation",
    promptProfileId: id,
    profileId: id,
    ...overrides,
  };
}

describe("resolveDefaultProfile", () => {
  it(
    "falls back to the first live descriptor when no default is saved",
    () => {
      const workflows = [
        makeDescriptor("custom_first"),
        makeDescriptor("custom_second"),
      ];
      const resolution = resolveDefaultProfile(workflows, "");
      expect(resolution.selectedProfileId).toBe("custom_first");
      expect(resolution.savedProfileId).toBeNull();
      expect(resolution.savedProfileStale).toBe(false);
    },
  );

  it("uses the saved default when it matches a live profile id", () => {
    const workflows = [
      makeDescriptor("first"),
      makeDescriptor("second"),
    ];
    const resolution = resolveDefaultProfile(workflows, "second");
    expect(resolution.selectedProfileId).toBe("second");
    expect(resolution.savedProfileId).toBe("second");
    expect(resolution.savedProfileStale).toBe(false);
  });

  it(
    "treats the saved default as stale when no live profile matches and "
    + "still reports the saved id so the caller can show an error",
    () => {
      const workflows = [
        makeDescriptor("only_option"),
      ];
      const resolution = resolveDefaultProfile(
        workflows,
        "removed_profile",
      );
      expect(resolution.savedProfileStale).toBe(true);
      expect(resolution.savedProfileId).toBe("removed_profile");
      expect(resolution.selectedProfileId).toBe("only_option");
    },
  );

  it("normalizes legacy profile aliases when matching saved settings", () => {
    const workflows = [makeDescriptor("autopilot")];
    const resolution = resolveDefaultProfile(workflows, "automatic");
    expect(resolution.selectedProfileId).toBe("autopilot");
    expect(resolution.savedProfileStale).toBe(false);
  });

  it("compares against descriptor.profileId rather than display name", () => {
    const workflows = [
      makeDescriptor("workflow-id-1", { profileId: "stored_profile" }),
    ];
    const resolution = resolveDefaultProfile(
      workflows,
      "stored_profile",
    );
    expect(resolution.selectedProfileId).toBe("workflow-id-1");
    expect(resolution.savedProfileStale).toBe(false);
  });

  it("returns undefined selected id when workflows list is empty", () => {
    const resolution = resolveDefaultProfile([], "anything");
    expect(resolution.selectedProfileId).toBeUndefined();
    expect(resolution.savedProfileStale).toBe(true);
  });
});
