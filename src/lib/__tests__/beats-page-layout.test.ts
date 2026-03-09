import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

describe("beats page layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/beats/page.tsx"),
    "utf8",
  );
  const beatTableSource = readFileSync(
    path.join(process.cwd(), "src/components/beat-table.tsx"),
    "utf8",
  );
  const appHeaderSource = readFileSync(
    path.join(process.cwd(), "src/components/app-header.tsx"),
    "utf8",
  );

  it("allows vertical scrolling in the main wrapper", () => {
    expect(source).toContain(
      'className="mx-auto max-w-[95vw] overflow-x-hidden px-4 pt-2"',
    );
    expect(source).not.toContain(
      'className="mx-auto max-w-[95vw] overflow-hidden px-4 pt-2"',
    );
  });

  it("binds Shift+H shortcut help globally for beats screens", () => {
    const shiftHHandler = appHeaderSource.match(
      /\/\/ Shift\+H toggles shortcut help in every Beats screen\.[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\}, \[isBeatsRoute\]\);/,
    )?.[0];

    expect(shiftHHandler).toBeTruthy();
    expect(shiftHHandler).toContain("if (!isBeatsRoute) return;");
    expect(shiftHHandler).toContain("if (!isHotkeyHelpToggleKey(e)) return;");
    expect(shiftHHandler).not.toContain('beatsView !== "queues"');
    expect(shiftHHandler).not.toContain('beatsView !== "active"');
  });

  it("binds Shift+R repo cycling globally for all screens", () => {
    const repoCycleHandler = appHeaderSource.match(
      /\/\/ Shift\+R cycles repos forward; Cmd\/Ctrl\+Shift\+R cycles backward \(all app screens\)\.[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\}, \[updateUrl\]\);/,
    )?.[0];

    expect(repoCycleHandler).toBeTruthy();
    expect(repoCycleHandler).toContain("getRepoCycleDirection(e)");
    expect(repoCycleHandler).toContain("useAppStore.getState()");
    expect(repoCycleHandler).toContain("cycleRepoPath(repos, currentActiveRepo, direction)");
    expect(repoCycleHandler).toContain('window.addEventListener("keydown", handleKeyDown, { capture: true });');
    expect(repoCycleHandler).not.toContain('beatsView !== "queues"');
    expect(repoCycleHandler).not.toContain('beatsView !== "active"');
  });

  it("constrains selected-row description and notes summaries on laptop widths", () => {
    expect(beatTableSource).toContain('className={`mt-1.5 flex max-w-[75%] text-xs leading-relaxed ${expanded ? "relative z-10" : ""}`}');
    expect(beatTableSource).toContain('className={`min-w-0 basis-[37.5%] ${rounded} px-2 py-1 ${bg}`}');
  });
});
