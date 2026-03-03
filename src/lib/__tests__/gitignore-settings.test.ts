import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Safety-net test: settings.toml (which may contain API keys) must be
 * listed in .gitignore so it is never accidentally committed.
 */
describe(".gitignore safety", () => {
  it("includes a settings.toml pattern", async () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const content = await readFile(
      path.join(repoRoot, ".gitignore"),
      "utf-8",
    );
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    expect(lines).toContain("settings.toml");
  });
});
