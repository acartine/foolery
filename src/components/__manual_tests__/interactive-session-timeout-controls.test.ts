import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
}

describe("interactive session timeout controls", () => {
  const settingsDefaultsSource = readSource(
    "src/components/settings-defaults-section.tsx",
  );
  const timeoutSectionSource = readSource(
    "src/components/settings-interactive-session-timeout-section.tsx",
  );

  it("renders an explicit timeout control in settings defaults", () => {
    expect(settingsDefaultsSource).toContain(
      "InteractiveSessionTimeoutSection",
    );
    expect(timeoutSectionSource).toContain(
      "Interactive Session Timeout",
    );
    expect(timeoutSectionSource).toContain(
      "interactive agent",
    );
  });
});
