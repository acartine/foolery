import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("retakes query enablement", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/retakes-view.tsx"),
    "utf8",
  );

  it("always enables query execution so default repo fallback can run", () => {
    expect(source).toContain("enabled: true");
    expect(source).not.toContain("enabled: Boolean(activeRepo) || registeredRepos.length > 0");
  });
});
