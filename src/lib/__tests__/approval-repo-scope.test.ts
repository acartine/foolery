import { describe, expect, it } from "vitest";
import type { ApprovalEscalation } from "@/lib/approval-escalations";
import {
  annotateApprovalsForRepo,
  selectActiveRepoApprovals,
} from "@/lib/approval-repo-scope";

function makeApproval(
  id: string,
  repoPath: string | undefined,
  createdAt = 0,
): ApprovalEscalation {
  return {
    id,
    notificationKey: id,
    logicalKey: id,
    status: "pending",
    sessionId: `sess-${id}`,
    beatId: `beat-${id}`,
    repoPath,
    adapter: "opencode",
    source: "permission.asked",
    options: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("annotateApprovalsForRepo", () => {
  it("flags approvals from a different repoPath as cross-repo", () => {
    const result = annotateApprovalsForRepo(
      [
        makeApproval("knots-rm", "/Users/cartine/knots", 10),
        makeApproval("foolery-edit", "/Users/cartine/foolery", 20),
      ],
      "/Users/cartine/foolery",
    );
    const knots = result.find((a) => a.id === "knots-rm");
    const foolery = result.find((a) => a.id === "foolery-edit");
    expect(knots?.isCrossRepo).toBe(true);
    expect(foolery?.isCrossRepo).toBe(false);
  });

  it("sorts active-repo approvals before cross-repo ones", () => {
    const result = annotateApprovalsForRepo(
      [
        makeApproval("knots-old", "/Users/cartine/knots", 1_000),
        makeApproval("foolery-new", "/Users/cartine/foolery", 2),
      ],
      "/Users/cartine/foolery",
    );
    expect(result.map((a) => a.id)).toEqual([
      "foolery-new",
      "knots-old",
    ]);
  });

  it("treats approvals without repoPath as local", () => {
    const result = annotateApprovalsForRepo(
      [makeApproval("anon", undefined)],
      "/Users/cartine/foolery",
    );
    expect(result[0]?.isCrossRepo).toBe(false);
  });
});

describe("selectActiveRepoApprovals", () => {
  it("hides cross-repo approvals when activeRepo is set", () => {
    const filtered = selectActiveRepoApprovals(
      [
        makeApproval("knots-rm", "/Users/cartine/knots"),
        makeApproval("foolery-edit", "/Users/cartine/foolery"),
      ],
      "/Users/cartine/foolery",
    );
    expect(filtered.map((a) => a.id)).toEqual([
      "foolery-edit",
    ]);
  });

  it("returns all approvals when activeRepo is empty", () => {
    const all = selectActiveRepoApprovals(
      [
        makeApproval("knots-rm", "/Users/cartine/knots"),
        makeApproval("foolery-edit", "/Users/cartine/foolery"),
      ],
      null,
    );
    expect(all).toHaveLength(2);
  });
});
