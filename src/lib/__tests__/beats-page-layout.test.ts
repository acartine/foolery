import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

function src(rel: string): string {
  return readFileSync(
    path.join(process.cwd(), rel), "utf8",
  );
}

describe("beats page layout", () => {
  const source = src("src/app/beats/page.tsx");
  const btSummary = src(
    "src/components/beat-table-summary.tsx",
  );
  const btContent = src(
    "src/components/beat-table-content.tsx",
  );
  const btMeta = src(
    "src/components/beat-table-metadata.tsx",
  );
  const appHeaderSource = src(
    "src/components/app-header.tsx",
  );
  const searchBarSource = src(
    "src/components/search-bar.tsx",
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

  it("uses shared beats view parsing in the header so search view is recognized", () => {
    expect(appHeaderSource).toContain('import { parseBeatsView } from "@/lib/beats-view";');
    expect(appHeaderSource).toContain(
      'const beatsView = parseBeatsView(searchParams.get("view"));',
    );
  });

  it("keeps the beats search control at a 20 character minimum before wrapping", () => {
    expect(searchBarSource).toContain(
      'className={cn("relative mx-2 flex-1 min-w-[20ch] max-w-md", className)}',
    );
    expect(searchBarSource).toContain(
      'fallback={<div className={cn("mx-2 flex-1 min-w-[20ch] max-w-md", className)} />}',
    );
    expect(appHeaderSource).toContain(
      'className="order-3 mx-0 basis-full md:order-none md:basis-auto md:flex-1 md:max-w-none"',
    );
  });

  it("treats search as a list/data view on the beats page", () => {
    expect(source).toContain(
      'import { isListBeatsView, parseBeatsView } from "@/lib/beats-view";',
    );
    expect(source).toContain(
      'const beatsView = parseBeatsView(searchParams.get("view"));',
    );
    expect(source).toContain(
      "const isListView = isListBeatsView(beatsView);",
    );
  });

  it("does not send the state filter when a search query is active", () => {
    expect(source).toContain('if (!searchQuery && filters.state) params.state = filters.state;');
    expect(source).toContain('if (searchQuery) params.q = searchQuery;');
  });

  it("constrains selected-row description and notes summaries on laptop widths", () => {
    expect(btSummary).toContain(
      '"mt-1.5 grid w-full max-w-full"',
    );
    expect(btSummary).toContain(
      '"grid-cols-[repeat(3,minmax(0,1fr))]"',
    );
    expect(btContent).toContain(
      "cells.findIndex(",
    );
    expect(btContent).toContain(
      'colSpan={cells.length - titleIdx}',
    );
    expect(btContent).toContain(
      'className="whitespace-normal pt-0"',
    );
    expect(btMeta).toContain(
      "const HANDOFF_METADATA_KEYS = [",
    );
  });
});
