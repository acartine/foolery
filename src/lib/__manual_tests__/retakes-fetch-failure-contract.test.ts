import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("retakes fetch failure handling", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/lib/retake-view-helpers.ts",
    ),
    "utf8",
  );

  it("throws when the active repo fetch fails so errors are visible", () => {
    expect(source).toContain(
      "const result = await fetchBeatsForScope(",
    );
  });

  it("throws when the shared scoped fetch fails", () => {
    expect(source).toContain(
      "throw new Error(",
    );
  });

  it("throws when single-repo fallback fetch fails", () => {
    expect(source).toContain(
      "result.error ?? \"Failed to load retake beats.\"",
    );
  });
});
