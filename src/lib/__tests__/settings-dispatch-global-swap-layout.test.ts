import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("dispatch global swap layout", () => {
  const dispatchSectionSource = readFileSync(
    path.join(process.cwd(), "src/components/settings-dispatch-section.tsx"),
    "utf8",
  );
  const poolsSectionSource = readFileSync(
    path.join(process.cwd(), "src/components/settings-pools-section.tsx"),
    "utf8",
  );

  it("keeps a single dispatch-level swap control outside the per-step pool editor", () => {
    expect(dispatchSectionSource).toContain("<SettingsDispatchGlobalSwap");
    expect(dispatchSectionSource).toContain("Swap Agent");
    expect(dispatchSectionSource).toContain(
      "Use this one Dispatch-level control to replace an agent everywhere.",
    );
    expect(poolsSectionSource).not.toContain("SettingsDispatchGlobalSwap");
    expect(poolsSectionSource).not.toContain("Global Swap Agent");
    expect(poolsSectionSource).not.toContain("dispatch-wide replacement");
  });

  it("keeps the per-step pool editor focused on pool editing", () => {
    expect(poolsSectionSource).toContain(
      "Configure weighted agent distribution per workflow step and dispatch target.",
    );
    expect(poolsSectionSource).not.toContain("Swap Agent");
  });
});
