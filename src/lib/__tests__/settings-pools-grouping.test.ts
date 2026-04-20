import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("settings pools grouping", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/settings-pools-section.tsx"),
    "utf8",
  );

  it("renders grouped bundled dispatch sections", () => {
    expect(source).toContain("bundledDispatchPoolGroups()");
    expect(source).toContain("{group.label}");
    expect(source).toContain("{group.description}");
  });

  it("keeps the settings-side add-to-all flow wired to bundled workflow targets", () => {
    expect(source).toContain("Add to all");
    expect(source).toContain("bundledWorkflowDispatchPoolTargets()");
    expect(source).toContain("DispatchPoolsBulkApply");
  });
});
