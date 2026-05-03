import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("beat detail lightbox sizing", () => {
  it("keeps the detail dialog at the widened desktop width", () => {
    const source = readSource("src/components/beat-detail-lightbox.tsx");

    // Must override both the unprefixed and sm: breakpoint max-width
    // because DialogContent's base class includes sm:max-w-lg
    expect(source).toContain('w-[95vw] max-w-[1600px] sm:max-w-[1600px]');
  });
});
