import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

describe("retakes pagination layout", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/retakes-view.tsx"),
    "utf8",
  );

  it("renders pagination controls above and below the retakes list", () => {
    const matches = source.match(/\{pageCount > 1 && renderPaginationControls\(\)\}/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("defaults the per-beat expanded details toggle to collapsed", () => {
    expect(source).toContain("const [showExpandedDetails, setShowExpandedDetails] = useState(false);");
  });

  it("gates steps, notes, and handoff capsules behind the per-beat toggle", () => {
    expect(source).toContain("import { BeatMetadataDetails } from \"@/components/beat-metadata-details\"");
    expect(source).toContain("<BeatMetadataDetails");
    expect(source).toContain("showExpandedDetails={showExpandedDetails}");
    expect(source).toContain("formatRelativeTime={relativeTime}");
  });

  it("uses a per-row disclosure control, not a page-level toggle", () => {
    // No page-level Switch toggle should exist
    expect(source).not.toContain('id="retakes-details-toggle"');
    expect(source).not.toContain('htmlFor="retakes-details-toggle"');
    // Disclosure button with aria-expanded should exist
    expect(source).toContain("aria-expanded={showExpandedDetails}");
  });
});
