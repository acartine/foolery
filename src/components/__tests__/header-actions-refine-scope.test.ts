import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Source-code verification tests for the Refine Scope
 * button in HeaderActions. Proves the button is wired
 * to the scope-refinement-pending store for disabled
 * state and pending indicator (acceptance criteria 1-5).
 */

function readSource(): string {
  return fs.readFileSync(
    path.resolve(
      __dirname,
      "../beat-detail-lightbox.tsx",
    ),
    "utf-8",
  );
}

function headerActionsSection(src: string): string {
  const marker = "function HeaderActions(";
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error(
      "HeaderActions function not found",
    );
  }
  return src.slice(start);
}

describe("HeaderActions – Refine Scope pending", () => {
  const src = readSource();
  const section = headerActionsSection(src);

  it("imports the pending store and selector", () => {
    expect(src).toContain(
      "useScopeRefinementPendingStore",
    );
    expect(src).toContain("selectIsPending");
  });

  it("reads isPending via selectIsPending(beat.id)", () => {
    expect(section).toContain(
      "selectIsPending(beat.id)",
    );
  });

  it("combines terminal, enqueuing, and isPending into refineDisabled", () => {
    expect(section).toMatch(
      /refineDisabled\s*=\s*\n?\s*terminal\s*\|\|\s*isEnqueuing\s*\|\|\s*isPending/,
    );
  });

  it("uses refineDisabled on the button disabled prop", () => {
    expect(section).toContain(
      "disabled={refineDisabled}",
    );
  });

  it("displays 'Refinement pending' label when isPending", () => {
    expect(section).toContain(
      "Refinement pending",
    );
    expect(section).toMatch(
      /isPending[\s\S]*?"Refinement pending"/,
    );
  });

  it("applies animate-spin to the icon when isPending", () => {
    expect(section).toMatch(
      /isPending[\s\S]*?animate-spin/,
    );
  });

  it("calls markPending(beat.id) after successful enqueue", () => {
    expect(section).toContain(
      "markPending(beat.id)",
    );
    const okIdx = section.indexOf("result.ok");
    const markIdx = section.indexOf(
      "markPending(beat.id)",
    );
    expect(markIdx).toBeGreaterThan(okIdx);
  });

  it("shows 'Refine Scope' as default button text", () => {
    expect(section).toContain(
      '"Refine Scope"',
    );
  });
});
