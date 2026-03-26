import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("app header create contract", () => {
  const hooksSource = readFileSync(
    path.join(process.cwd(), "src/components/app-header-hooks.ts"),
    "utf8",
  );
  const partsSource = readFileSync(
    path.join(process.cwd(), "src/components/app-header-parts.tsx"),
    "utf8",
  );

  it("routes keyboard creation through the all-repos chooser when needed", () => {
    expect(hooksSource).toContain("const [menuOpen, setMenuOpen] = useState(false);");
    expect(hooksSource).toContain("const openFlow = useCallback(() => {");
    expect(hooksSource).toContain("if (shouldChooseRepo) {");
    expect(hooksSource).toContain("setMenuOpen(true);");
    expect(hooksSource).toContain("openFlow();");
  });

  it("keeps the all-repos add button as a controlled repo picker", () => {
    expect(partsSource).toContain("open={menuOpen}");
    expect(partsSource).toContain("onOpenChange={setMenuOpen}");
    expect(partsSource).toContain('title="Choose repository to create beat (Shift+N)"');
    expect(hooksSource).toContain("openDialog(defaultRepo);");
  });
});
