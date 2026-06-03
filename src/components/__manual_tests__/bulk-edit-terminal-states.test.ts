/**
 * Manual source-grep tests for BulkEditControls.
 *
 * Reads the bulk-edit component sources from the real filesystem to
 * assert structural conventions (Apply button pattern, no direct
 * onBulkUpdate from Select handlers). Source-grep tests violate the
 * project's Hermetic Test Policy, so they live here and are excluded
 * from the default suite. Run with `bun run test:manual`.
 *
 * The hermetic descriptor-based assertion is preserved in the matching
 * file under `__tests__/`.
 */

import { describe, expect, it } from "vitest";

async function readSource(relPath: string): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return fs.readFileSync(path.resolve(__dirname, relPath), "utf-8");
}

describe("BulkEditControls – source-grep contract", () => {
  it("uses pending state and Apply button instead of immediate onBulkUpdate", async () => {
    const controls = await readSource("../bulk/bulk-edit-controls.tsx");
    const popover = await readSource("../bulk/bulk-edit-fields-popover.tsx");

    // Field editors should set pending state, not call onBulkUpdate directly.
    expect(popover).toContain("setPending(");
    // Apply button handler should exist.
    expect(controls).toContain("handleApply");
    // Key-based remount for dropdown reset.
    expect(controls).toContain("resetKey");
    // The Apply handler should forward accumulated fields to onBulkUpdate.
    expect(controls).toContain("onBulkUpdate(buildUpdateFields(pending))");
  });

  it("does not call onBulkUpdate directly from any Select onValueChange", async () => {
    const popover = await readSource("../bulk/bulk-edit-fields-popover.tsx");

    // In the field popover, onValueChange handlers should only call
    // setPending, never onBulkUpdate directly.
    const onValueChangeBlocks = popover.match(/onValueChange=\{[^}]+\}/g) ?? [];
    expect(onValueChangeBlocks.length).toBeGreaterThan(0);
    for (const block of onValueChangeBlocks) {
      expect(block).not.toContain("onBulkUpdate");
    }
  });
});
