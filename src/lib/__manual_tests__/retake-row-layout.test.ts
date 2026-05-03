import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("retake row layout", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/components/retake-row-parts.tsx",
    ),
    "utf8",
  );

  it("lets the title row shrink within the retakes list width", () => {
    expect(source).toContain(
      'className="flex min-w-0 items-center gap-2"',
    );
    expect(source).toContain(
      '"min-w-0 flex-1 truncate text-sm font-medium"',
    );
  });
});
