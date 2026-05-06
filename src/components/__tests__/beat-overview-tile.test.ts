import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeatOverviewTile } from "@/components/beat-overview-tile";
import type { Beat } from "@/lib/types";

function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "foolery-1111",
    title: "Overview tag test",
    type: "work",
    state: "implementation",
    priority: 2,
    labels: [],
    created: "2026-05-01T00:00:00.000Z",
    updated: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("BeatOverviewTile", () => {
  it("renders user-visible beat tags and hides internal labels", () => {
    const html = renderToStaticMarkup(
      createElement(BeatOverviewTile, {
        beat: makeBeat({
          labels: [
            "api",
            "stage:implementation",
            "orchestration:wave:test",
            "commit:abc123",
          ],
        }),
        showRepoColumn: false,
        isAllRepositories: false,
        leaseInfo: null,
        onOpenBeat: () => {},
        onFocusLeaseSession: () => {},
        onReleaseBeat: () => {},
      }),
    );

    expect(html).toContain("api");
    expect(html).toContain("beat-overview-tag");
    expect(html).not.toContain("stage:implementation");
    expect(html).not.toContain("orchestration:wave:test");
    expect(html).not.toContain("commit:abc123");
  });
});
