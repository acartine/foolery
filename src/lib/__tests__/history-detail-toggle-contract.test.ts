import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function readHistorySource(): string {
  return [
    "src/hooks/use-agent-history-state.ts",
    "src/components/agent-history-view.tsx",
    "src/components/agent-history-detail-panel.tsx",
    "src/components/agent-history-beat-detail.tsx",
  ].map(readSource).join("\n");
}

describe("history detail toggle contract", () => {
  const historyViewSource = readHistorySource();

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
