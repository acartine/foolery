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
    expect(dispatchSectionSource).toContain("Global dispatch tools");
    expect(poolsSectionSource).not.toContain("SettingsDispatchGlobalSwap");
    expect(poolsSectionSource).not.toContain("Global Swap Agent");
  });

  it("guides pool editing toward the global swap control instead of embedding one per step", () => {
    expect(poolsSectionSource).toContain(
      "For a full replacement across Dispatch, use the single global Swap",
    );
  });
});
