import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

function src(rel: string): string {
  return readFileSync(
    path.join(process.cwd(), rel), "utf8",
  );
}

const pageSource = src("src/app/beats/page.tsx");
const btSummary = src(
  "src/components/beat-table-summary.tsx",
);
const btContent = src(
  "src/components/beat-table-content.tsx",
);
const btHelpersSource = src(
  "src/components/beat-column-helpers.tsx",
);
const btMeta = src(
  "src/components/beat-table-metadata.tsx",
);
const appHeaderSource = src(
  "src/components/app-header.tsx",
);
const appHeaderHooksSource = src(
  "src/components/app-header-hooks.ts",
);
const appHeaderPartsSource = src(
  "src/components/app-header-parts.tsx",
);
const searchBarSource = src(
  "src/components/search-bar.tsx",
);
const beatsQuerySource = src(
  "src/app/beats/use-beats-query.ts",
);
const tableUiSource = src(
  "src/components/ui/table.tsx",
);
const colDefsSource = src(
  "src/components/beat-column-defs.tsx",
);
const globalStylesSource = src(
  "src/app/globals.css",
);

describe("beats page layout: scrolling and hotkeys", () => {
  it("allows vertical scrolling in the main wrapper", () => {
    expect(pageSource).toContain(
      "overflow-x-hidden",
    );
    expect(pageSource).not.toContain(
      '"mx-auto max-w-[95vw] overflow-hidden px-4 pt-2"',
    );
  });

  it("reserves scrollbar gutter space to prevent header jitter between views", () => {
    expect(globalStylesSource).toContain(
      "scrollbar-gutter: stable;",
    );
  });

  it("binds Shift+H shortcut help globally for beats screens", () => {
    expect(appHeaderHooksSource).toContain(
      "useHotkeyHelpHotkey",
    );
    expect(appHeaderHooksSource).toContain(
      "if (!isBeats) return;",
    );
    expect(appHeaderHooksSource).toContain(
      "if (!isHotkeyHelpToggleKey(e)) return;",
    );
    // Hotkey help hook must not be view-gated
    const hotkeyFn = appHeaderHooksSource.match(
      /function useHotkeyHelpHotkey[\s\S]*?^\}/m,
    )?.[0] ?? "";
    expect(hotkeyFn).not.toContain(
      'beatsView !== "queues"',
    );
    expect(hotkeyFn).not.toContain(
      'beatsView !== "active"',
    );
  });

  it("binds Shift+R repo cycling globally for all screens", () => {
    expect(appHeaderHooksSource).toContain(
      "useRepoCycleHotkey",
    );
    expect(appHeaderHooksSource).toContain(
      "getRepoCycleDirection(e)",
    );
    expect(appHeaderHooksSource).toContain(
      "useAppStore.getState()",
    );
    expect(appHeaderHooksSource).toContain(
      "cycleRepoPath(repos, cur, dir)",
    );
    expect(appHeaderHooksSource).toContain(
      "{ capture: true }",
    );
    // Repo cycle hook must not be view-gated
    const repoFn = appHeaderHooksSource.match(
      /function useRepoCycleHotkey[\s\S]*?^\}/m,
    )?.[0] ?? "";
    expect(repoFn).not.toContain(
      'beatsView !== "queues"',
    );
    expect(repoFn).not.toContain(
      'beatsView !== "active"',
    );
  });

  it("uses shared beats view parsing in the header so search view is recognized", () => {
    expect(appHeaderSource).toContain(
      'import { parseBeatsView } from "@/lib/beats-view";',
    );
    expect(appHeaderSource).toContain(
      "parseBeatsView(",
    );
  });

  it("keeps the beats search control at a 20 character minimum before wrapping", () => {
    expect(searchBarSource).toContain(
      "min-w-[20ch] max-w-md",
    );
    expect(searchBarSource).toContain(
      "min-w-[20ch] max-w-md",
    );
    expect(appHeaderPartsSource).toContain(
      "order-3",
    );
  });

});

describe("beats page layout: row vertical alignment", () => {
  it("uses align-middle on TableCell for consistent row alignment", () => {
    expect(tableUiSource).toContain("align-middle");
    expect(tableUiSource).not.toContain("align-top");
  });

  it("uses h-5 on queue-row pills to match Badge height", () => {
    // Profile pill
    expect(colDefsSource).toContain(
      '"inline-flex h-5 items-center rounded"',
    );
    // Owner type pills should not use py-0.5 leading-none
    const ownerSection = colDefsSource.slice(
      colDefsSource.indexOf("ownerTypeColumn"),
    );
    expect(ownerSection).toContain("h-5");
    expect(ownerSection).not.toContain("leading-none");
  });

  it("centers title column contents vertically", () => {
    expect(colDefsSource).toContain(
      'className="flex items-center gap-0.5"',
    );
  });
});

describe("beats page layout: search and table content", () => {
  it("treats search as a list/data view on the beats page", () => {
    expect(pageSource).toContain("isListBeatsView");
    expect(pageSource).toContain("parseBeatsView");
    expect(pageSource).toContain(
      "isListBeatsView(beatsView)",
    );
  });

  it("does not send the state filter when a search query is active", () => {
    expect(beatsQuerySource).toContain(
      "if (!searchQuery && filters.state)",
    );
    expect(beatsQuerySource).toContain(
      "if (searchQuery) params.q = searchQuery;",
    );
  });

  it("constrains selected-row description and notes summaries on laptop widths", () => {
    expect(btSummary).toContain(
      '"mt-1.5 grid w-full max-w-full"',
    );
    expect(btSummary).toContain(
      '"grid-cols-[repeat(3,minmax(0,1fr))]"',
    );
    expect(btContent).toContain(
      "colSpan={totalCols}",
    );
    expect(btContent).toContain(
      'className="whitespace-normal pt-0"',
    );
    expect(btContent).toContain(
      "InlineTitleContent",
    );
    expect(btMeta).toContain(
      "const HANDOFF_METADATA_KEYS = [",
    );
  });

  it("keeps the divider below the inline title metadata row", () => {
    const beatRowSource = btContent.match(
      /function BeatTableRow[\s\S]*?function cellClassName/m,
    )?.[0] ?? "";
    const titleCellStart = btHelpersSource.indexOf(
      "export function TitleCell",
    );
    const titleCellSource =
      titleCellStart >= 0
        ? btHelpersSource.slice(titleCellStart)
        : "";

    const borderlessRowIndex = beatRowSource.indexOf(
      '"border-b-0"',
    );
    const inlineTitleRowIndex = beatRowSource.indexOf(
      "InlineTitleContent",
    );
    const titleIndex = titleCellSource.indexOf(
      "{beat.title}",
    );
    const metadataIndex = titleCellSource.indexOf(
      "TitleMetaBadges",
    );

    expect(borderlessRowIndex).toBeGreaterThan(-1);
    expect(inlineTitleRowIndex).toBeGreaterThan(
      borderlessRowIndex,
    );
    expect(beatRowSource).toContain(
      'className="pt-0 pb-1 truncate"',
    );
    expect(beatRowSource).toContain("colSpan={totalCols}");
    expect(titleIndex).toBeGreaterThan(-1);
    expect(metadataIndex).toBeGreaterThan(titleIndex);
  });
});
