import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readComponent(name: string): string {
  return readFileSync(
    join(process.cwd(), "src/components", name),
    "utf8",
  );
}

describe("FinalCutView approvals tabs contract", () => {
  const finalCut = readComponent("final-cut-view.tsx");
  const approvalsPanel = readComponent("approval-escalations-panel.tsx");

  it("keeps the existing human-action beat query and BeatTable", () => {
    expect(finalCut).toContain('requiresHumanAction: "true"');
    expect(finalCut).toContain("<BeatTable");
    expect(finalCut).toContain("fetchBeatsForScope");
  });

  it("adds Human Beats and Approvals tabs", () => {
    expect(finalCut).toContain('<TabsTrigger value="notes">');
    expect(finalCut).toContain("Human Beats");
    expect(finalCut).toContain('<TabsTrigger value="approvals">');
    expect(finalCut).toContain("Approvals");
  });

  it("reads pending approvals from the approval escalation store", () => {
    expect(finalCut).toContain("useApprovalEscalationStore");
    expect(finalCut).toContain("selectPendingApprovals");
    expect(finalCut).toContain("<ApprovalEscalationsPanel");
  });

  it("shows real approval actions and manual fallback messaging", () => {
    expect(approvalsPanel).toContain("Manual action");
    expect(approvalsPanel).toContain(
      "Programmatic approval is not available",
    );
    expect(approvalsPanel).toContain('action="approve"');
    expect(approvalsPanel).toContain('action="reject"');
  });

  it("scopes the approvals view to the active repo", () => {
    expect(finalCut).toContain("annotateApprovalsForRepo");
    expect(finalCut).toContain("activeRepo");
  });

  it("renders cross-repo, agent identity, and detected timestamp on rows", () => {
    expect(approvalsPanel).toContain("approval-cross-repo-badge");
    expect(approvalsPanel).toContain("approval-agent");
    expect(approvalsPanel).toContain("approval-created");
    expect(approvalsPanel).toContain("formatAgentDisplayLabel");
    expect(approvalsPanel).toContain("formatRelativeTimestamp");
  });
});
