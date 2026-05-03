import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
}

describe("terminal light theme controls", () => {
  const terminalToolbarSource = readSource(
    "src/components/terminal-toolbar.tsx",
  );
  const historyHeaderSource = readSource(
    "src/components/history-debug-sub.tsx",
  );
  const settingsDefaultsSource = readSource(
    "src/components/settings-defaults-section.tsx",
  );
  const settingsSheetSource = readSource(
    "src/components/settings-sheet.tsx",
  );
  const terminalPanelStateSource = readSource(
    "src/hooks/use-terminal-panel-state.ts",
  );

  it("renders a Light Theme toggle in live terminal, history terminal, and settings", () => {
    expect(terminalToolbarSource).toContain(
      "Light Theme",
    );
    expect(historyHeaderSource).toContain(
      "Light Theme",
    );
    expect(settingsDefaultsSource).toContain(
      "Light Theme",
    );
  });

  it("routes the three controls through the shared preference hook", () => {
    expect(settingsSheetSource).toContain(
      "useTerminalThemePreference",
    );
    expect(settingsSheetSource).toContain(
      "themePref.setLightTheme(value)",
    );
    expect(terminalPanelStateSource).toContain(
      "useTerminalThemePreference",
    );
    expect(historyHeaderSource).toContain(
      "onLightThemeChange",
    );
  });
});
