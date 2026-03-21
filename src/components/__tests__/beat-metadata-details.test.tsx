import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BeatMetadataDetails } from "@/components/beat-metadata-details";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-ee66",
    title: "History detail metadata",
    description: "Primary description",
    type: "work",
    state: "implementation",
    priority: 2,
    labels: [],
    created: "2026-03-21T09:00:00.000Z",
    updated: "2026-03-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("BeatMetadataDetails", () => {
  it("always renders the description but hides steps, notes, and handoff capsules until expanded", () => {
    const html = renderToStaticMarkup(
      createElement(BeatMetadataDetails, {
        beat: makeBeat({
          metadata: {
            knotsSteps: [{ content: "Moved to implementation" }],
            knotsNotes: [{ content: "Need to show metadata entries" }],
            knotsHandoffCapsules: [{ content: "Shared history details implementation." }],
          },
        }),
        showExpandedDetails: false,
      }),
    );

    expect(html).toContain("Description");
    expect(html).toContain("Primary description");
    expect(html).not.toContain("Steps");
    expect(html).not.toContain("Moved to implementation");
    expect(html).not.toContain("Notes");
    expect(html).not.toContain("Need to show metadata entries");
    expect(html).not.toContain("Handoff Capsules");
    expect(html).not.toContain("Shared history details implementation.");
  });

  it("renders steps, notes, and handoff capsules when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(BeatMetadataDetails, {
        beat: makeBeat({
          metadata: {
            knotsSteps: [{ content: "Moved to implementation", agentname: "codex" }],
            knotsNotes: [{ content: "Need to show metadata entries", username: "cartine" }],
            knotsHandoffCapsules: [{ content: "Shared history details implementation." }],
          },
        }),
        showExpandedDetails: true,
      }),
    );

    expect(html).toContain("Steps");
    expect(html).toContain("Moved to implementation");
    expect(html).toContain("Notes");
    expect(html).toContain("Need to show metadata entries");
    expect(html).toContain("Handoff Capsules");
    expect(html).toContain("Shared history details implementation.");
  });

  it("falls back to legacy beat notes when structured metadata notes are absent", () => {
    const html = renderToStaticMarkup(
      createElement(BeatMetadataDetails, {
        beat: makeBeat({
          notes: "Legacy top-level note",
          metadata: {
            knotsSteps: [{ content: "Moved to implementation" }],
          },
        }),
        showExpandedDetails: true,
      }),
    );

    expect(html).toContain("Notes");
    expect(html).toContain("Legacy top-level note");
  });
});
