import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("settings pools layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/settings-pools-section.tsx"),
    "utf8",
  );

  it("sizes the pool agent row from rendered content instead of fixed widths", () => {
    expect(source).toContain("grid-cols-[auto_minmax(0,1fr)_auto_auto]");
    expect(source).toContain(
      "sm:grid-cols-[max-content_auto_minmax(0,1fr)_auto_auto]",
    );
    expect(source).toContain("col-span-4 min-w-0 flex items-start gap-2");
    expect(source).not.toContain("w-[140px] sm:w-[220px] min-w-0");
  });
});
