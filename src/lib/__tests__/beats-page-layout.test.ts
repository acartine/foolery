import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

describe("beats page layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/beats/page.tsx"),
    "utf8",
  );
  const beatTableSource = readFileSync(
    path.join(
      process.cwd(),
      "src/components/beat-table.tsx",
    ),
    "utf8",
  );
  const appHeaderSource = readFileSync(
    path.join(
      process.cwd(),
      "src/components/app-header.tsx",
    ),
    "utf8",
  );
  const appHeaderHooksSource = readFileSync(
    path.join(
      process.cwd(),
      "src/components/app-header-hooks.ts",
    ),
    "utf8",
  );
  const appHeaderPartsSource = readFileSync(
    path.join(
      process.cwd(),
      "src/components/app-header-parts.tsx",
    ),
    "utf8",
  );
  const searchBarSource = readFileSync(
    path.join(
      process.cwd(),
      "src/components/search-bar.tsx",
    ),
    "utf8",
  );
  const beatsQuerySource = readFileSync(
    path.join(
      process.cwd(),
      "src/app/beats/use-beats-query.ts",
    ),
    "utf8",
  );

  it("allows vertical scrolling in the main wrapper", () => {
    expect(source).toContain(
      "overflow-x-hidden",
    );
    expect(source).not.toContain(
      '"mx-auto max-w-[95vw] overflow-hidden px-4 pt-2"',
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

  it("treats search as a list/data view on the beats page", () => {
    expect(source).toContain("isListBeatsView");
    expect(source).toContain("parseBeatsView");
    expect(source).toContain(
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
    expect(beatTableSource).toContain(
      "grid-cols-[repeat(3,minmax(0,1fr))]",
    );
    expect(beatTableSource).toContain(
      'cell.column.id === "title"',
    );
    expect(beatTableSource).toContain(
      "whitespace-normal pt-0",
    );
    expect(beatTableSource).toContain(
      "const HANDOFF_METADATA_KEYS = [",
    );
  });
});
