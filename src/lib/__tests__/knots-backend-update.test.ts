import { describe, expect, it } from "vitest";
import {
  buildUpdatePatch,
  hasPatchFields,
} from "@/lib/backends/knots-backend-update";
import type { Beat } from "@/lib/types";
import type { UpdateBeatInput } from "@/lib/schemas";
import { defaultWorkflowDescriptor } from "@/lib/workflows";

function makeBeat(
  verificationSteps: string[],
): Beat {
  return {
    id: "KNOT-1",
    title: "Mapped knot",
    type: "work",
    state: "implementation",
    profileId: "autopilot",
    priority: 2,
    labels: [],
    verificationSteps,
    created: "2026-05-27T10:00:00.000Z",
    updated: "2026-05-27T10:00:00.000Z",
  };
}

function patchFor(
  currentSteps: string[],
  input: UpdateBeatInput,
) {
  return buildUpdatePatch(
    makeBeat(currentSteps),
    input,
    defaultWorkflowDescriptor(),
    false,
  );
}

describe("buildUpdatePatch verification steps", () => {
  it("omits verification fields when lists are equivalent", () => {
    const patch = patchFor(["Run lint"], {
      verificationSteps: ["Run lint"],
    });

    expect(patch.addVerificationSteps).toBeUndefined();
    expect(patch.removeVerificationSteps).toBeUndefined();
    expect(patch.clearVerificationSteps).toBeUndefined();
    expect(hasPatchFields(patch)).toBe(false);
  });

  it("serializes added steps", () => {
    const patch = patchFor(["Run lint"], {
      verificationSteps: ["Run lint", "Run tests"],
    });

    expect(patch.addVerificationSteps).toEqual(["Run tests"]);
    expect(patch.removeVerificationSteps).toBeUndefined();
    expect(hasPatchFields(patch)).toBe(true);
  });

  it("serializes removed steps", () => {
    const patch = patchFor(["Run lint", "Run tests"], {
      verificationSteps: ["Run tests"],
    });

    expect(patch.addVerificationSteps).toBeUndefined();
    expect(patch.removeVerificationSteps).toEqual(["Run lint"]);
  });

  it("serializes mixed add and remove changes", () => {
    const patch = patchFor(["Run lint", "Run tests"], {
      verificationSteps: ["Run tests", "Run build"],
    });

    expect(patch.addVerificationSteps).toEqual(["Run build"]);
    expect(patch.removeVerificationSteps).toEqual(["Run lint"]);
  });

  it("uses clear when the next list is empty after a non-empty current list", () => {
    const patch = patchFor(["Run lint"], {
      verificationSteps: [],
    });

    expect(patch.clearVerificationSteps).toBe(true);
    expect(patch.addVerificationSteps).toBeUndefined();
    expect(patch.removeVerificationSteps).toBeUndefined();
  });

  it("keeps empty-to-empty changes as a no-op", () => {
    const patch = patchFor([], {
      verificationSteps: [],
    });

    expect(hasPatchFields(patch)).toBe(false);
  });
});
