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

  it("defaults each beat row details disclosure to collapsed", () => {
    expect(source).toContain("const [showExpandedDetails, setShowExpandedDetails] = useState(false);");
    expect(source).toContain("{showExpandedDetails && renderedSteps.length > 0 && (");
    expect(source).toContain("{showExpandedDetails && renderedNotes.length > 0 && (");
    expect(source).toContain("{showExpandedDetails && renderedCapsules.length > 0 && (");
  });

  it("uses a per-row disclosure control instead of a shared page toggle", () => {
    expect(source).toContain("aria-label={showExpandedDetails ? \"Collapse retake activity details\" : \"Expand retake activity details\"}");
    expect(source).toContain("title={showExpandedDetails ? \"Hide steps, notes, and handoff capsules\" : \"Show steps, notes, and handoff capsules\"}");
    expect(source).not.toContain("retakes-details-toggle");
    expect(source).not.toContain("Show notes and handoff capsules");
  });
});
