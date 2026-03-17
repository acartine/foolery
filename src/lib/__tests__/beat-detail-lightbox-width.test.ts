import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("beat detail lightbox sizing", () => {
  it("keeps the detail dialog at the widened desktop width", () => {
    const source = readSource("src/components/beat-detail-lightbox.tsx");

    expect(source).toContain('w-[95vw] max-w-[1600px]');
  });
});
