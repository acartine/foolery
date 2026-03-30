import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("settings pools layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/settings-pools-section.tsx"),
    "utf8",
  );
  const labelSource = readFileSync(
    path.join(process.cwd(), "src/components/agent-display-label.tsx"),
    "utf8",
  );

  it("keeps the pool row on the original fixed-width flex layout", () => {
    expect(source).toContain("flex items-center gap-2 rounded-lg");
    expect(source).toContain("w-[140px] sm:w-[220px] min-w-0");
    expect(source).not.toContain("grid-cols-[auto_minmax(0,1fr)_auto_auto]");
  });

  it("stacks pool-row pills beneath the label without changing the shared default layout", () => {
    expect(source).toContain('<AgentDisplayLabel agent={agent} layout="stacked" />');
    expect(labelSource).toContain('layout?: "inline" | "stacked";');
    expect(labelSource).toContain('layout = "inline"');
    expect(labelSource).toContain(
      'isStacked ? "inline-flex flex-col items-start gap-1" : "inline-flex items-center gap-1.5"',
    );
    expect(labelSource).toContain('className="flex max-w-full flex-wrap items-center gap-1.5"');
  });
});
