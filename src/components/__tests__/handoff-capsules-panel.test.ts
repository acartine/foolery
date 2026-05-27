import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HandoffCapsulesPanel } from "@/components/handoff-capsules-panel";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-da13",
    title: "Display handoff capsules in details",
    type: "work",
    state: "implementation",
    priority: 2,
    labels: [],
    created: "2026-05-27T08:00:00.000Z",
    updated: "2026-05-27T08:30:00.000Z",
    ...overrides,
  };
}

function renderPanel(beat: Beat): string {
  return renderToStaticMarkup(
    createElement(HandoffCapsulesPanel, { beat }),
  );
}

describe("HandoffCapsulesPanel", () => {
  it("renders handoff capsule content in reverse chronological order", () => {
    const html = renderPanel(makeBeat({
      metadata: {
        knotsHandoffCapsules: [
          {
            id: "older",
            content: "Older implementation context.",
            agentname: "codex",
          },
          {
            id: "newer",
            summary: "Newest review handoff.",
            model: "gpt-5",
          },
        ],
      },
    }));

    expect(html).toContain("Handoff Capsules");
    expect(html).toContain("Older implementation context.");
    expect(html).toContain("Newest review handoff.");
    expect(html).toContain("codex");
    expect(html).toContain("gpt-5");
    expect(html.indexOf("Newest review handoff.")).toBeLessThan(
      html.indexOf("Older implementation context."),
    );
  });

  it("renders nothing when the beat has no handoff capsules", () => {
    expect(renderPanel(makeBeat())).toBe("");
    expect(renderPanel(makeBeat({
      metadata: { knotsHandoffCapsules: [] },
    }))).toBe("");
  });

  it("uses the shared legacy aliases and content fields", () => {
    const html = renderPanel(makeBeat({
      metadata: {
        handoff_capsules: [{
          description: "Legacy alias capsule detail.",
          username: "cartine",
        }],
      },
    }));

    expect(html).toContain("Handoff Capsules");
    expect(html).toContain("Legacy alias capsule detail.");
    expect(html).toContain("cartine");
  });
});
