import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { RETAKE_TARGET_STATE } from "@/lib/retake";

describe("retake lightbox contract", () => {
  const retakesViewSource = readFileSync(
    path.join(process.cwd(), "src/components/retakes-view.tsx"),
    "utf8",
  );
  const retakeDialogSource = readFileSync(
    path.join(process.cwd(), "src/components/retake-dialog.tsx"),
    "utf8",
  );

  it("keeps the canonical retake target state", () => {
    expect(RETAKE_TARGET_STATE).toBe("ready_for_implementation");
  });

  it("reopens beats into ready_for_implementation", () => {
    expect(retakesViewSource).toContain("state: RETAKE_TARGET_STATE");
    expect(retakesViewSource).not.toContain('state: "implementation"');
  });

  it("shows ready_for_implementation in the retake dialog copy", () => {
    expect(retakeDialogSource).toContain("{RETAKE_TARGET_STATE}");
    expect(retakeDialogSource).not.toContain("as in_progress");
  });

  it("exposes Stage and Retake Now buttons instead of a single ReTake submit", () => {
    // Dialog must have both action buttons
    expect(retakeDialogSource).toContain('"Stage"');
    expect(retakeDialogSource).toContain('"Retake Now"');
    // The old single ReTake submit button should be gone
    expect(retakeDialogSource).not.toMatch(/>\s*{[^}]*"ReTake"\s*}\s*</);
  });

  it("exports RetakeAction type for callers", () => {
    expect(retakeDialogSource).toContain('export type RetakeAction');
    expect(retakeDialogSource).toContain('"stage"');
    expect(retakeDialogSource).toContain('"retake-now"');
  });

  it("dialog onConfirm passes the action to the caller", () => {
    // onConfirm signature accepts action parameter
    expect(retakeDialogSource).toContain('onConfirm: (notes: string, action: RetakeAction)');
  });
});
