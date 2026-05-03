import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

describe("settings sheet scroll layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/settings-sheet.tsx"),
    "utf8",
  );

  it("keeps overflow scrolling on the constrained outer wrapper", () => {
    expect(source).toContain(
      '<div className="px-4 flex-1 min-h-0 overflow-y-auto">',
    );
    expect(source).toContain('<div className="py-3">');
  });

  it("does not place overflow scrolling on the inner content stack", () => {
    expect(source).not.toContain(
      'className="py-3 overflow-y-auto flex-1"',
    );
  });

  it("does not include an enabled toggle for scope refinement", () => {
    expect(source).not.toContain("enabled: false");
    expect(source).not.toContain("enabled: true");
  });
});
