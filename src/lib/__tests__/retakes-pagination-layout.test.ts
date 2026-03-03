import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

describe("retakes pagination layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/retakes-view.tsx"),
    "utf8",
  );

  it("renders pagination controls above and below the retakes list", () => {
    const matches = source.match(/\{pageCount > 1 && renderPaginationControls\(\)\}/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});
