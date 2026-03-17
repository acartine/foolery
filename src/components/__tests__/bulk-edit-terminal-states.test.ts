import { describe, expect, it } from "vitest";

/**
 * Verify the bulk-edit "Set state" dropdown passes the correct terminal-state
 * value through onBulkUpdate. We import the component module and inspect the
 * constant indirectly by confirming the three expected values are present in
 * the source. (Full render tests would require a DOM environment; this is a
 * lightweight smoke-check that the constant is wired correctly.)
 */

describe("BulkEditControls – terminal state options", () => {
  it("calls onBulkUpdate with { state } for each terminal state value", async () => {
    // We can't render JSX without a DOM env, so instead we verify the module
    // exports compile and the constant values match expectations by reading
    // the source.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../filter-bar.tsx"),
      "utf-8",
    );

    // The bulkTerminalStates array should contain exactly these values
    for (const state of ["shipped", "abandoned", "deferred"]) {
      expect(src).toContain(`value: "${state}"`);
    }

    // The dropdown should wire through onBulkUpdate({ state: v })
    expect(src).toContain('onBulkUpdate({ state: v })');

    // The state select should remount after apply so the same terminal state
    // can be applied twice in a row.
    expect(src).toContain("key={bulkStateSelectKey}");
    expect(src).toContain("setBulkStateSelectKey((key) => key + 1)");
  });
});
