import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readWorkflowSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("release runtime artifact workflow", () => {
  it("includes a native linux arm64 build target", () => {
    const source = readWorkflowSource(".github/workflows/release-runtime-artifact.yml");

    expect(source).toContain("target: linux-arm64");
    expect(source).toContain("runner: ubuntu-24.04-arm");
    expect(source).toContain("runs-on: ${{ matrix.runner }}");
  });
});
