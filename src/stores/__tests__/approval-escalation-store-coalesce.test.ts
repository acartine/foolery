import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvalEscalationFromRequest,
} from "@/lib/approval-escalations";
import {
  selectPendingApprovals,
  useApprovalEscalationStore,
} from "@/stores/approval-escalation-store";

const RM_PATH =
  "rm /Users/cartine/knots/src/db/tests_pagination.rs";

function baseRequest() {
  return {
    adapter: "opencode",
    source: "permission.asked",
    options: [] as string[],
    patterns: [RM_PATH] as string[],
    toolName: "bash",
    toolUseId: "functions.bash:39",
    nativeSessionId: "ses_dd956e8140019cf3",
    permissionName: "bash",
    supportedActions: [
      "approve",
      "always_approve",
      "reject",
    ] as const,
  };
}

const context = {
  sessionId: "term-1777467128491-z9jcxs",
  beatId: "knots-9aa6",
  repoPath: "/Users/cartine/knots",
};

describe("approval store coalesces OpenCode permission rotations", () => {
  beforeEach(() => {
    useApprovalEscalationStore.setState({ approvals: [] });
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collapses two events differing only in permissionId", () => {
    const baseA = baseRequest();
    const baseB = baseRequest();
    const first = approvalEscalationFromRequest(
      {
        ...baseA,
        supportedActions: [...baseA.supportedActions],
        permissionId: "per_dd956e814001",
        requestId: "per_dd956e814001",
        replyTarget: {
          adapter: "opencode",
          transport: "http",
          nativeSessionId: baseA.nativeSessionId,
          permissionId: "per_dd956e814001",
          requestId: "per_dd956e814001",
        },
      },
      { ...context, timestamp: 1 },
    );
    const second = approvalEscalationFromRequest(
      {
        ...baseB,
        supportedActions: [...baseB.supportedActions],
        permissionId: "per_dd956e822001",
        requestId: "per_dd956e822001",
        replyTarget: {
          adapter: "opencode",
          transport: "http",
          nativeSessionId: baseB.nativeSessionId,
          permissionId: "per_dd956e822001",
          requestId: "per_dd956e822001",
        },
      },
      { ...context, timestamp: 2 },
    );

    const store = useApprovalEscalationStore.getState();
    expect(store.upsertPendingApproval(first)).toBe(true);
    expect(store.upsertPendingApproval(second)).toBe(false);

    const pending = selectPendingApprovals(
      useApprovalEscalationStore.getState(),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]!.permissionId).toBe(
      "per_dd956e822001",
    );
    expect(pending[0]!.replyTarget?.permissionId).toBe(
      "per_dd956e822001",
    );
  });
});
