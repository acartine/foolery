import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("history detail toggle contract", () => {
  const historyViewSource = readFileSync(
    path.join(process.cwd(), "src/components/agent-history-view.tsx"),
    "utf8",
  );

  it("tracks expanded metadata visibility in view state", () => {
    expect(historyViewSource).toContain("const [showExpandedDetails, setShowExpandedDetails] = useState(false)");
    expect(historyViewSource).toContain("setShowExpandedDetails((prev) => !prev)");
    expect(historyViewSource).toContain("aria-expanded={showExpandedDetails}");
    expect(historyViewSource).toContain('aria-label={showExpandedDetails ? "Collapse details" : "Expand details"}');
  });

  it("wires the focused beat detail panel through the shared metadata details component", () => {
    expect(historyViewSource).toContain("import { BeatMetadataDetails } from \"@/components/beat-metadata-details\"");
    expect(historyViewSource).toContain("<BeatMetadataDetails");
    expect(historyViewSource).toContain("showExpandedDetails={showExpandedDetails}");
    expect(historyViewSource).toContain("formatRelativeTime={relativeTime}");
  });
});
