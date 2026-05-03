import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("url state sync reload behavior", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/url-state-sync.tsx"),
    "utf8",
  );

  it("restores the persisted repo when the URL has no repo param", () => {
    expect(source).toContain("const persisted = getPersistedRepoSelection();");
    expect(source).toContain('if (persisted?.kind === "repo") {');
    expect(source).toContain('params.set("repo", persisted.path);');
    expect(source).toContain("router.replace(`${pathname}?${params.toString()}`);");
  });

  it("rewrites the URL even when the store already matches the persisted repo", () => {
    expect(source).toContain('if (persisted?.kind === "repo") {');
    expect(source).toContain("if (persisted.path !== store.activeRepo) {");
    expect(source).not.toContain('if (persisted?.kind === "repo" && persisted.path !== store.activeRepo) {');
  });

  it("restores an intentional all-repositories selection without overwriting the current view", () => {
    expect(source).toContain('if (persisted?.kind === "all" && store.activeRepo !== null) {');
    expect(source).not.toContain('params.delete("view")');
  });
});
