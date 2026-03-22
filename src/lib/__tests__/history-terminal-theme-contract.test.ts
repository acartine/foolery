import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("history terminal theme contract", () => {
  const historyViewSource = readFileSync(
    path.join(process.cwd(), "src/components/agent-history-view.tsx"),
    "utf8",
  );
  const pickerSource = readFileSync(
    path.join(process.cwd(), "src/components/interaction-picker.tsx"),
    "utf8",
  );

  it("keeps the conversation log on the terminal palette and mono typography", () => {
    expect(historyViewSource).toContain('bg-[#1a1a2e]');
    expect(historyViewSource).toContain('bg-[#16162a]');
    expect(historyViewSource).toContain('text-[#e0e0e0]');
    expect(historyViewSource).toContain("font-mono");
    expect(historyViewSource).toContain("subpixel-antialiased");
  });

  it("keeps interaction controls on the same terminal surfaces and contrast scale", () => {
    expect(pickerSource).toContain('bg-[#1a1a2e]');
    expect(pickerSource).toContain('bg-[#16162a]');
    expect(pickerSource).toContain('text-[#e0e0e0]');
    expect(pickerSource).toContain("text-white/60");
    expect(pickerSource).toContain("font-mono");
  });
});
