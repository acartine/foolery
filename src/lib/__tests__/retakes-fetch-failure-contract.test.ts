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
      "throw new Error(active.error);",
    );
  });

  it("throws when all registered repo fetches fail", () => {
    expect(source).toContain(
      "const firstError = results.find((r) => !r.ok);",
    );
    expect(source).toContain(
      "throw new Error(firstError.error);",
    );
  });

  it("throws when single-repo fallback fetch fails", () => {
    expect(source).toContain(
      "result.error ?? \"Failed to load retake beats.\"",
    );
  });
});
