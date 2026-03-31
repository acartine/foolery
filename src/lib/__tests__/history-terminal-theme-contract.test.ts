import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function readHistorySource(): string {
  return [
    "src/components/agent-history-view.tsx",
    "src/components/agent-history-conversation-log.tsx",
    "src/components/agent-history-conversation-log-theme.ts",
    "src/components/agent-history-session-card.tsx",
    "src/components/agent-history-response-row.tsx",
    "src/components/agent-history-beat-detail.tsx",
    "src/components/agent-history-beat-row.tsx",
    "src/components/agent-history-detail-panel.tsx",
  ].map(readSource).join("\n");
}

function readPickerSource(): string {
  return [
    "src/components/interaction-picker.tsx",
    "src/components/interaction-picker-ui.tsx",
    "src/components/interaction-filter-dropdown.tsx",
  ].map(readSource).join("\n");
}

describe("history terminal theme contract", () => {
  const historyViewSource = readHistorySource();
  const pickerSource = readPickerSource();

  it(
    "supports both dark and light terminal conversation palettes with mono typography",
    () => {
    expect(historyViewSource).toContain('bg-[#1a1a2e]');
    expect(historyViewSource).toContain('bg-[#16162a]');
    expect(historyViewSource).toContain('text-[#e0e0e0]');
    expect(historyViewSource).toContain('bg-[#f8f9fa]');
    expect(historyViewSource).toContain('bg-[#f0f0f0]');
    expect(historyViewSource).toContain('text-slate-900');
    expect(historyViewSource).toContain("font-mono");
    expect(historyViewSource).toContain("subpixel-antialiased");
    },
  );

  it("keeps interaction controls on the same terminal surfaces and contrast scale", () => {
    expect(pickerSource).toContain('bg-[#1a1a2e]');
    expect(pickerSource).toContain('bg-[#16162a]');
    expect(pickerSource).toContain('text-[#e0e0e0]');
    expect(pickerSource).toContain("text-white/60");
    expect(pickerSource).toContain("font-mono");
  });
});
