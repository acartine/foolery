import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("settings pools grouping", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/settings-pools-section.tsx"),
    "utf8",
  );

  it("renders one tab per dispatch workflow", () => {
    expect(source).toContain("dispatchWorkflowGroups()");
    expect(source).toContain("TabsTrigger");
    expect(source).toContain("{group.label}");
    expect(source).toContain("{group.description}");
  });

  it("keeps the settings-side add-to-all flow wired to workflow targets", () => {
    expect(source).toContain("Add to all");
    expect(source).toContain("dispatchWorkflowPoolTargets()");
    expect(source).toContain("DispatchPoolsBulkApply");
  });
});
