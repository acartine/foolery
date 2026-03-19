import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("max concurrent sessions wiring", () => {
  it("reads the setting in the beats page instead of using a hardcoded session cap", () => {
    const pageSource = readSource("src/app/beats/page.tsx");

    expect(pageSource).toContain("fetchSettings");
    expect(pageSource).toContain("defaults?.maxConcurrentSessions");
    expect(pageSource).not.toContain("const MAX_SESSIONS = 5;");
  });

  it("reads the setting in terminal-manager instead of using a hardcoded session cap", () => {
    const managerSource = readSource("src/lib/terminal-manager.ts");

    expect(managerSource).toContain("settings.defaults?.maxConcurrentSessions");
    expect(managerSource).toContain("Max concurrent sessions (${maxConcurrentSessions}) reached");
    expect(managerSource).not.toContain("const MAX_SESSIONS = 5;");
  });
});
