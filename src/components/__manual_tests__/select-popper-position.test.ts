import { describe, expect, it } from "vitest";

/**
 * Verify that the shared Select wrapper uses popper positioning
 * instead of item-aligned. The item-aligned mode causes Radix to
 * manipulate page scroll position when opening, which produces
 * visible viewport jitter in dense layouts like the Queues View
 * filter bar.
 */

describe("SelectContent – popper positioning", () => {
  it("defaults to position=\"popper\" to prevent scroll jitter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../ui/select.tsx"),
      "utf-8",
    );

    // The default must be "popper", not "item-aligned"
    expect(src).toContain('position = "popper"');
    expect(src).not.toContain('position = "item-aligned"');
  });

  it("does not use item-aligned in any call site", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const filterBar = fs.readFileSync(
      path.resolve(__dirname, "../filter-bar.tsx"),
      "utf-8",
    );

    // No call site should override back to item-aligned
    expect(filterBar).not.toContain("item-aligned");
  });
});
