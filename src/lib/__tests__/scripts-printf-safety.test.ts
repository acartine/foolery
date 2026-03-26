import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Regression test: bare `printf '-…'` is a bash bug because
 * printf interprets a leading dash as an option flag.
 * The safe form is `printf '%s' '-…'`.
 */
describe("scripts printf safety", () => {
  const scriptsDir = path.join(process.cwd(), "scripts");

  const shFiles = readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".sh"));

  it("finds at least one .sh file in scripts/", () => {
    expect(shFiles.length).toBeGreaterThan(0);
  });

  it.each(shFiles)(
    "%s has no bare printf with dash-prefixed argument",
    (file) => {
      const content = readFileSync(
        path.join(scriptsDir, file),
        "utf8",
      );
      const lines = content.split("\n");
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match printf '- but NOT printf '%s' '-
        // Also skip comment lines
        if (
          line.trimStart().startsWith("#")
        ) continue;
        if (
          /printf\s+'-./.test(line)
          && !/printf\s+'%s'\s+'-./.test(line)
        ) {
          violations.push(
            `line ${i + 1}: ${line.trim()}`,
          );
        }
      }

      expect(
        violations,
        `Found bare printf with dash-prefixed arg:\n`
        + violations.join("\n"),
      ).toHaveLength(0);
    },
  );
});
