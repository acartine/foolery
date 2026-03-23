import path from "node:path";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("history beat-id copy affordance contract", () => {
  const historyViewSource = readFileSync(
    path.join(process.cwd(), "src/components/agent-history-view.tsx"),
    "utf8",
  );

  it("copies the stripped beat id to clipboard with success and failure feedback", () => {
    expect(historyViewSource).toContain("const shortId = stripIdPrefix(beatId)");
    expect(historyViewSource).toContain("navigator.clipboard.writeText(shortId)");
    expect(historyViewSource).toContain("toast.success(`Copied: ${shortId}`)");
    expect(historyViewSource).toContain('toast.error("Failed to copy to clipboard")');
  });

  it("keeps every history surface wired to the shared copy handler", () => {
    expect(historyViewSource).toContain("copyBeatId(beat.beatId)");
    expect(historyViewSource).toContain("copyBeatId(focusedSummary.beatId)");
    expect(historyViewSource).toContain("copyBeatId(loadedSummary.beatId)");
    expect(historyViewSource).toContain("showExpandedDetails={showExpandedDetails}");
    expect(historyViewSource).toContain("onCopyBeatId={copyBeatId}");
    expect(historyViewSource).toContain("onClick={() => onCopyBeatId(beat.id)}");
  });

  it("renders stripped ids on every copy affordance surface", () => {
    expect(historyViewSource).toContain("const displayId = displayBeatLabel(beat.beatId, beatDetailMap.get(key)?.aliases)");
    expect(historyViewSource).toContain("{displayBeatLabel(focusedSummary.beatId, focusedDetail.beat?.aliases)}");
    expect(historyViewSource).toContain("{displayBeatLabel(loadedSummary.beatId, loadedDetail?.aliases)}");
    expect(historyViewSource).toContain("{displayBeatLabel(beat.id, beat.aliases)}");
  });

  it("retains explicit copy affordance cues for beat ids", () => {
    const affordanceTitleMatches = historyViewSource.match(/title=\"Click to copy ID\"/g) ?? [];
    expect(affordanceTitleMatches.length).toBeGreaterThanOrEqual(4);
  });
});
