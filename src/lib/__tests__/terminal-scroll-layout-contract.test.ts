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
const minimizedBarSource = src(
  "src/components/minimized-terminal-bar.tsx",
);
const terminalViewportSource = src(
  "src/lib/terminal-viewport.ts",
);

describe("terminal scroll layout contract", () => {
  it("reads the terminal viewport state needed for Queue/Active insets", () => {
    expect(pageSource).toContain(
      "panelOpen",
    );
    expect(pageSource).toContain(
      "panelMinimized",
    );
    expect(pageSource).toContain(
      "panelHeight",
    );
    expect(pageSource).toContain(
      "terminalCount: terminals.length",
    );
  });

  it("limits the terminal inset to Queue and Active views", () => {
    expect(pageSource).toContain(
      'beatsView === "queues" || beatsView === "active"',
    );
    expect(pageSource).toContain(
      ': "0px";',
    );
  });

  it("keeps minimized bar height and list inset on the same shared constant", () => {
    expect(terminalViewportSource).toContain(
      "MINIMIZED_TERMINAL_BAR_HEIGHT_PX",
    );
    expect(minimizedBarSource).toContain(
      "height: `${MINIMIZED_TERMINAL_BAR_HEIGHT_PX}px`",
    );
    expect(pageSource).toContain(
      "style={{ paddingBottom: listViewportInset }}",
    );
  });
});
