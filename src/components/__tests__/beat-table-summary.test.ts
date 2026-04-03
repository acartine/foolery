import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineSummary } from "@/components/beat-table-summary";
import type { RenderedCapsule } from "@/components/beat-table-metadata";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-500d",
    title: "Acceptance summary coverage",
    type: "work",
    state: "implementation",
    priority: 2,
    labels: [],
    created: "2026-04-03T08:00:00.000Z",
    updated: "2026-04-03T08:30:00.000Z",
    ...overrides,
  };
}

function renderSummary(
  beat: Beat,
  capsules: RenderedCapsule[] = [],
): string {
  return renderToStaticMarkup(
    createElement(InlineSummary, { beat, capsules }),
  );
}

describe("InlineSummary", () => {
  it("renders acceptance-only beats instead of returning null", () => {
    const html = renderSummary(
      makeBeat({ acceptance: "Ship after the queue renders cleanly." }),
    );

    expect(html).not.toBe("");
    expect(html).toContain("Acceptance criteria");
    expect(html).toContain("Ship after the queue renders cleanly.");
  });

  it("keeps the summary labels in the expected order", () => {
    const html = renderSummary(
      makeBeat({
        description: "Primary description",
        acceptance: "Acceptance text",
        notes: "Notes text",
      }),
    );

    const descriptionIndex = html.indexOf("Description");
    const acceptanceIndex = html.indexOf("Acceptance criteria");
    const notesIndex = html.indexOf("Notes");
    const handoffIndex = html.indexOf("Handoff Capsules");

    expect(descriptionIndex).toBeGreaterThan(-1);
    expect(acceptanceIndex).toBeGreaterThan(descriptionIndex);
    expect(notesIndex).toBeGreaterThan(acceptanceIndex);
    expect(handoffIndex).toBeGreaterThan(notesIndex);
    expect(html).toContain("Acceptance text");
  });
});
