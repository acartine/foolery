import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("repo switcher all-repositories contract", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/repo-switcher.tsx"),
    "utf8",
  );

  it("bootstraps repo selection only once after registry hydration", () => {
    expect(source).toContain("const didBootstrapRepoRef = useRef(false);");
    expect(source).toContain("if (didBootstrapRepoRef.current) return;");
    expect(source).toContain("didBootstrapRepoRef.current = true;");
  });

  it("does not override an intentional all-repositories selection", () => {
    expect(source).toContain('if (activeRepo || data.data.length === 0 || searchParams.has("repo")) {');
    expect(source).toContain('<DropdownMenuItem onClick={() => updateUrl({ repo: null })}>');
  });
});
