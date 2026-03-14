import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("app header create contract", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/app-header.tsx"),
    "utf8",
  );

  it("routes keyboard creation through the all-repos chooser when needed", () => {
    expect(source).toContain("const [createRepoMenuOpen, setCreateRepoMenuOpen] = useState(false);");
    expect(source).toContain("const openCreateFlow = useCallback(() => {");
    expect(source).toContain("if (shouldChooseRepo) {");
    expect(source).toContain("setCreateRepoMenuOpen(true);");
    expect(source).toContain("openCreateFlow();");
  });

  it("keeps the all-repos add button as a controlled repo picker", () => {
    expect(source).toContain('<DropdownMenu open={createRepoMenuOpen} onOpenChange={setCreateRepoMenuOpen}>');
    expect(source).toContain('title="Choose repository to create beat (Shift+N)"');
    expect(source).toContain("openCreateDialog(defaultRepo);");
  });
});
