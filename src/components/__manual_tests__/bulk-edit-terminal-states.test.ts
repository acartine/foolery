/**
 * Manual source-grep tests for BulkEditControls.
 *
 * Reads `src/components/filter-bar.tsx` from the real filesystem to
 * assert structural conventions (Apply button pattern, no direct
 * onBulkUpdate from Select handlers). Source-grep tests violate the
 * project's Hermetic Test Policy, so they live here and are excluded
 * from the default suite. Run with `bun run test:manual`.
 *
 * The hermetic descriptor-based assertion is preserved in the matching
 * file under `__tests__/`.
 */

import { describe, expect, it } from "vitest";

describe("BulkEditControls – source-grep contract", () => {
  it("uses pending state and Apply button instead of immediate onBulkUpdate", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../filter-bar.tsx"),
      "utf-8",
    );

    // Dropdowns should set pending state, not call onBulkUpdate directly
    expect(src).toContain("setPending(");
    // Apply button should exist
    expect(src).toContain("handleApply");
    // Key-based remount for dropdown reset
    expect(src).toContain("resetKey");
    // The Apply button should call onBulkUpdate with accumulated fields
    expect(src).toContain("onBulkUpdate(fields)");
  });

  it("does not call onBulkUpdate directly from any Select onValueChange", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../filter-bar.tsx"),
      "utf-8",
    );

    // In the BulkEditControls function body, onValueChange handlers should
    // only call setPending, not onBulkUpdate directly
    const bulkEditSection = src.slice(
      src.indexOf("export function BulkEditControls"),
      src.indexOf("function FilterControls"),
    );

    const onValueChangeBlocks = bulkEditSection.match(/onValueChange=\{[^}]+\}/g) ?? [];
    for (const block of onValueChangeBlocks) {
      expect(block).not.toContain("onBulkUpdate");
    }
  });
});
