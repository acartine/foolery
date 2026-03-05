import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

describe("beats page layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/beats/page.tsx"),
    "utf8",
  );

  it("allows vertical scrolling in the main wrapper", () => {
    expect(source).toContain(
      'className="mx-auto max-w-[95vw] overflow-x-hidden px-4 pt-2"',
    );
    expect(source).not.toContain(
      'className="mx-auto max-w-[95vw] overflow-hidden px-4 pt-2"',
    );
  });
});
