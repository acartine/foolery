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
    expect(dispatchSectionSource).toContain("Global Swap Agent");
    expect(dispatchSectionSource).toContain(
      "Use this one control to replace an agent everywhere in Dispatch.",
    );
    expect(poolsSectionSource).not.toContain("SettingsDispatchGlobalSwap");
    expect(poolsSectionSource).not.toContain("Swap Agent tool");
  });

  it("keeps the per-step pool editor focused on step-local edits", () => {
    expect(poolsSectionSource).toContain(
      "These editors only change one step at a time.",
    );
    expect(poolsSectionSource).toContain(
      "For a dispatch-wide replacement, use the Global Swap Agent control at",
    );
  });
});
