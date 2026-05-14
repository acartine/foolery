import { createElement } from "react";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverviewStateMatrix } from "@/components/beat-state-overview-matrix";
import type { BeatStateGroup } from "@/lib/beat-state-overview";

function renderMatrix(groups: BeatStateGroup[]): string {
  const gridStyle = {
    "--overview-column-width": "40px",
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

  it("lets the header wrap title and count onto additional rows", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    const headerStart = section.indexOf("<div");
    const headerOpenEnd = section.indexOf(">", headerStart);
    const headerOpenTag = section.slice(headerStart, headerOpenEnd + 1);
    const headerClass = extractFirstAttribute(headerOpenTag, "class");
    expect(headerClass).toMatch(/\bflex\b/);
    expect(headerClass).toMatch(/\bflex-wrap\b/);
    expect(headerClass).toMatch(/\bitems-start\b/);
    expect(headerClass).not.toMatch(/\bjustify-between\b/);
  });

  it("renders hide control and count inside a wrapping container", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    const hideButton = 'data-testid="beat-state-column-hide"';
    const hideIdx = section.indexOf(hideButton);
    expect(hideIdx).toBeGreaterThan(0);
    const wrapperStart = section.lastIndexOf("<div", hideIdx);
    const wrapperOpenEnd = section.indexOf(">", wrapperStart);
    const wrapperTag = section.slice(
      wrapperStart,
      wrapperOpenEnd + 1,
    );
    const wrapperClass = extractFirstAttribute(wrapperTag, "class");
    expect(wrapperClass).toMatch(/\bflex-wrap\b/);
    expect(wrapperClass).not.toMatch(/\bshrink-0\b/);
    expect(wrapperClass).toMatch(/\bmin-w-0\b/);
    expect(section).toContain(
      'aria-label="Hide Ready Impl Review column"',
    );
  });

  it("keeps the title badge able to wrap onto multiple lines", () => {
    const html = renderMatrix([
      emptyGroup("ready_for_implementation_review"),
    ]);
    const section = extractColumnSection(
      html,
      "ready_for_implementation_review",
    );
    // The state label "Ready Impl Review" wraps as plain text.
    expect(section).toContain("Ready Impl Review");
    // The badge must opt into wrap + break-words to stay within the
    // narrow column width.
    expect(section).toMatch(/whitespace-normal[^"]*break-words/);
    expect(section).toMatch(/min-w-0[^"]*shrink/);
  });
});
