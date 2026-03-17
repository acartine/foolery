import { describe, expect, it } from "vitest";

/**
 * Verify the bulk-edit controls use an Apply-button pattern with
 * key-based remount for dropdown reset, and that the terminal-state
 * dropdown values are wired correctly.
 */

describe("BulkEditControls – Apply button pattern", () => {
  it("contains the expected terminal state values", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../filter-bar.tsx"),
      "utf-8",
    );

    for (const state of ["shipped", "abandoned", "deferred"]) {
      expect(src).toContain(`value: "${state}"`);
    }
  });

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
