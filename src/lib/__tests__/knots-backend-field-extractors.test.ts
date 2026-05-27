import { describe, expect, it } from "vitest";
import {
  extractVerificationSteps,
} from "@/lib/backends/knots-backend-field-extractors";
import type { KnotRecord } from "@/lib/knots";

function knot(
  verificationSteps: unknown,
): KnotRecord {
  return {
    id: "KNOT-1",
    title: "Knot",
    state: "implementation",
    updated_at: "2026-05-27T10:00:00.000Z",
    verification_steps: verificationSteps as string[] | null,
  };
}

describe("extractVerificationSteps", () => {
  it("returns an empty array for missing, null, and non-array fields", () => {
    const missing = knot(undefined);
    delete missing.verification_steps;

    expect(extractVerificationSteps(missing)).toEqual([]);
    expect(extractVerificationSteps(knot(null))).toEqual([]);
    expect(extractVerificationSteps(knot("nope"))).toEqual([]);
  });

  it("filters non-strings and blank strings while trimming values", () => {
    const steps = [
      " Run lint ",
      "",
      "  ",
      42,
      "Run tests",
    ];

    expect(extractVerificationSteps(knot(steps))).toEqual([
      "Run lint",
      "Run tests",
    ]);
  });
});
