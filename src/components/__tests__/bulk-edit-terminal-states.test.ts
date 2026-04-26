import { describe, expect, it } from "vitest";
import { collectBulkSetStateOptions } from "../filter-bar";

/**
 * Verify the bulk-edit controls use an Apply-button pattern with
 * key-based remount for dropdown reset, and that the bulk Set-state
 * dropdown options are sourced from the loom-derived workflow
 * descriptors (no hardcoded state names in the component source —
 * see CLAUDE.md §"State Classification Is Loom-Derived").
 */

describe("BulkEditControls – Apply button pattern", () => {
  it("derives bulk Set-state options from workflow descriptors", () => {
    const options = collectBulkSetStateOptions();
    const values = options.map((option) => option.value);
    // The builtin autopilot/semiauto profiles expose `shipped` and
    // `abandoned` as terminal states and `deferred` as a wildcard
    // transition target. The runtime list must include them — but the
    // assertion is on what `collectBulkSetStateOptions` produces, NOT
    // on whether the literals appear in the source file.
    expect(values).toContain("shipped");
    expect(values).toContain("abandoned");
    expect(values).toContain("deferred");
    // Every option must carry a human-readable label.
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
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
