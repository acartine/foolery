import { createElement } from "react";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverviewStateMatrix } from "@/components/beat-state-overview-matrix";
import type { BeatStateGroup } from "@/lib/beat-state-overview";

function renderMatrix(groups: BeatStateGroup[]): string {
  const gridStyle = {
    gridTemplateColumns: "repeat(1, minmax(80px, 1fr))",
  } as CSSProperties;
  return renderToStaticMarkup(
    createElement(OverviewStateMatrix, {
      tabs: [
        { id: "work_items", label: "Work Items", count: 0 },
      ],
      activeTab: "work_items",
      onTabChange: () => {},
      visibleGroups: groups,
      gridStyle,
      showRepoColumn: false,
      isAllRepositories: false,
      leaseInfoByBeatKey: {},
      onOpenBeat: () => {},
      onFocusLeaseSession: () => {},
      onReleaseBeat: () => {},
      onHideColumn: () => {},
    }),
  );
}

function emptyGroup(state: string): BeatStateGroup {
  return { state, required: true, beats: [] };
}

function extractColumnSection(
  html: string,
  state: string,
): string {
  const marker = `data-testid="beat-state-group-${state}"`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`column for ${state} not found`);
  const sectionStart = html.lastIndexOf("<section", start);
  const sectionEnd = html.indexOf("</section>", start);
  return html.slice(sectionStart, sectionEnd + "</section>".length);
}

function extractFirstAttribute(
  html: string,
  attribute: string,
): string {
  const match = html.match(
    new RegExp(`${attribute}="([^"]*)"`),
  );
  if (!match) throw new Error(`attribute ${attribute} not found`);
  return match[1];
}

function extractOpeningTagByTestId(
  html: string,
  testId: string,
): string {
  const marker = `data-testid="${testId}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`test id ${testId} not found`);
  }
  const tagStart = html.lastIndexOf("<", markerIndex);
  const tagEnd = html.indexOf(">", markerIndex);
  return html.slice(tagStart, tagEnd + 1);
}

describe("OverviewStateMatrix column fill", () => {
  it("drives column widths from the fr template, not fixed tracks", () => {
    // Regression guard for foolery-c5fc: fixed `auto-cols` tracks left empty
    // space when columns were hidden. The grid must instead apply the
    // caller's `grid-template-columns` so `1fr` tracks fill the table.
    const html = renderMatrix([emptyGroup("implementation")]);
    const gridTag = extractOpeningTagByTestId(
      html,
      "beat-state-overview-grid",
    );
    const gridClass = extractFirstAttribute(gridTag, "class");
    expect(gridClass).not.toMatch(/\bauto-cols-/);
    expect(gridClass).not.toMatch(/\bgrid-flow-col\b/);
    expect(gridTag).toMatch(/grid-template-columns:\s*repeat\(/);
    expect(gridTag).toContain("minmax(80px, 1fr)");
  });
});

describe("OverviewStateMatrix header wrapping", () => {
  it("does not clip the column wrapper so headers can grow vertically", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    const sectionClass = extractFirstAttribute(section, "class");
    expect(sectionClass).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);
    expect(sectionClass).toMatch(/\bborder\b/);
    expect(section).toContain("divide-y divide-border/60 overflow-hidden");
  });

  it("lets the header content wrap title and count onto rows", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    const headerTag = extractOpeningTagByTestId(
      section,
      "beat-state-column-header",
    );
    const headerClass = extractFirstAttribute(headerTag, "class");
    expect(headerClass).toMatch(/\bmin-h-7\b/);
    expect(headerClass).not.toMatch(/\boverflow-hidden\b/);

    const contentTag = extractOpeningTagByTestId(
      section,
      "beat-state-column-header-content",
    );
    const contentClass = extractFirstAttribute(contentTag, "class");
    expect(contentClass).toMatch(/\bflex\b/);
    expect(contentClass).toMatch(/\bflex-wrap\b/);
    expect(contentClass).toMatch(/\bitems-start\b/);
    expect(contentClass).not.toMatch(/\bjustify-between\b/);
  });

  it("renders title, hide control, and count as wrapping siblings", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    const labelTag = extractOpeningTagByTestId(
      section,
      "beat-state-column-label",
    );
    const labelClass = extractFirstAttribute(labelTag, "class");
    expect(labelClass).toMatch(/\bmin-w-0\b/);
    expect(labelClass).toMatch(/\bmax-w-full\b/);
    expect(labelClass).toContain("flex-[1_1_3.25rem]");

    const hideIdx = section.indexOf(
      'data-testid="beat-state-column-hide"',
    );
    const countIdx = section.indexOf(
      'data-testid="beat-state-column-count"',
    );
    expect(hideIdx).toBeGreaterThan(0);
    expect(countIdx).toBeGreaterThan(hideIdx);

    const hideTag = extractOpeningTagByTestId(
      section,
      "beat-state-column-hide",
    );
    const countTag = extractOpeningTagByTestId(
      section,
      "beat-state-column-count",
    );
    expect(extractFirstAttribute(hideTag, "class")).toMatch(/\bshrink-0\b/);
    expect(extractFirstAttribute(countTag, "class")).toMatch(/\bshrink-0\b/);
    expect(section).toContain(
      'aria-label="Hide Ready Impl Review column"',
    );
  });
});

describe("OverviewStateMatrix header labels", () => {
  it("keeps the title badge able to wrap onto multiple lines", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    expect(section).toContain("Ready Impl Review");
    expect(section).toMatch(/whitespace-normal[^"]*wrap-anywhere/);
    expect(section).toMatch(/block[^"]*w-full[^"]*min-w-0/);
  });

  it("uses wrap-anywhere on the title badge to prevent overflow", () => {
    // Regression guard for foolery-cbc8: the previous `break-words` value
    // didn't shrink the flex min-content size and let labels bleed into
    // adjacent columns when all columns were visible.
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    expect(section).toMatch(/\bwrap-anywhere\b/);
    expect(section).not.toMatch(/\bbreak-words\b/);
  });
});
