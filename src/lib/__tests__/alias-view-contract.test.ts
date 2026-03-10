import path from "node:path";
import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DepTree } from "@/components/dep-tree";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("alias view contracts", () => {
  it("keeps alias-aware labels wired into the knot id views", () => {
    const beatColumnsSource = readSource("src/components/beat-columns.tsx");
    const lightboxSource = readSource("src/components/beat-detail-lightbox.tsx");
    const depTreeSource = readSource("src/components/dep-tree.tsx");
    const retakesSource = readSource("src/components/retakes-view.tsx");
    const cascadeSource = readSource("src/components/cascade-close-dialog.tsx");

    expect(beatColumnsSource).toContain("displayBeatLabel(row.original.id, row.original.aliases)");
    expect(lightboxSource).toContain("getDisplayedBeatAliases(beat)");
    expect(depTreeSource).toContain("displayBeatLabel(linkedId, dep.aliases)");
    expect(retakesSource).toContain("displayBeatLabel(beat.id, beat.aliases)");
    expect(cascadeSource).toContain("displayBeatLabel(d.id, d.aliases)");
  });

  it("renders dependency aliases before the stripped id fallback", () => {
    const html = renderToStaticMarkup(
      React.createElement(DepTree, {
        beatId: "foolery-parent",
        deps: [
          {
            id: "foolery-df3a",
            aliases: ["ship-views"],
            source: "foolery-parent",
            target: "foolery-df3a",
          },
        ],
        repo: "/repo/demo",
      }),
    );

    expect(html).toContain("ship-views");
    expect(html).toContain("df3a");
    expect(html).toContain("<span>ship-views</span><span class=\"text-[10px] text-muted-foreground\">df3a</span>");
  });
});
