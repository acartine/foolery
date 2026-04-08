import path from "node:path";
import { readFileSync } from "node:fs";
import {
  describe,
  expect,
  it,
} from "vitest";

function src(rel: string): string {
  return readFileSync(
    path.join(process.cwd(), rel), "utf8",
  );
}

const pageSource = src("src/app/beats/page.tsx");
const providerSource = src(
  "src/components/providers.tsx",
);
const insetSyncSource = src(
  "src/components/terminal-viewport-inset-sync.tsx",
);
const terminalViewportSource = src(
  "src/lib/terminal-viewport.ts",
);
const globalCssSource = src(
  "src/app/globals.css",
);

describe("terminal scroll layout contract", () => {
  it("syncs terminal viewport state into a shared body inset", () => {
    expect(insetSyncSource).toContain(
      "panelOpen",
    );
    expect(insetSyncSource).toContain(
      "panelMinimized",
    );
    expect(insetSyncSource).toContain(
      "panelHeight",
    );
    expect(insetSyncSource).toContain(
      "terminalCount: terminals.length",
    );
  });

  it("registers the terminal viewport inset sync globally", () => {
    expect(providerSource).toContain(
      "TerminalViewportInsetSync",
    );
  });

  it("applies the shared terminal inset through global layout styles", () => {
    expect(terminalViewportSource).toContain(
      "getTerminalViewportInset",
    );
    expect(globalCssSource).toContain(
      "padding-bottom: var(--terminal-viewport-inset);",
    );
    expect(globalCssSource).toContain(
      "scroll-padding-bottom: var(",
    );
    expect(pageSource).not.toContain(
      "style={{ paddingBottom: listViewportInset }}",
    );
  });
});
