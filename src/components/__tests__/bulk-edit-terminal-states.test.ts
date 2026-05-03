import { describe, expect, it } from "vitest";
import { collectBulkSetStateOptions } from "../filter-bar";

/**
 * Verify the bulk Set-state dropdown options are sourced from the
 * loom-derived workflow descriptors (no hardcoded state names —
 * see CLAUDE.md §"State Classification Is Loom-Derived").
 *
 * Source-grep assertions (Apply-button wiring, no direct onBulkUpdate
 * from Select handlers) live in the matching manual test file under
 * `__manual_tests__/` because they require real fs reads.
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
});
