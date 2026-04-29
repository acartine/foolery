import { describe, expect, it } from "vitest";
import {
  approvalEscalationFromRequest,
  buildApprovalLogicalKey,
  formatApprovalDetailText,
} from "@/lib/approval-escalations";

const RM_PATH =
  "rm /Users/cartine/knots/src/db/tests_pagination.rs";

describe("formatApprovalDetailText fallbacks", () => {
  it("renders a meaningful pattern when no message/params are set", () => {
    const detail = formatApprovalDetailText({
      message: undefined,
      question: undefined,
      toolParamsDisplay: undefined,
      parameterSummary: undefined,
      options: [],
      patterns: [RM_PATH],
      permissionName: "bash",
      toolName: "bash",
      toolUseId: "functions.bash:39",
    });

    expect(detail).toBe(RM_PATH);
    expect(detail).not.toBe("{}");
  });

  it("treats raw {} parameter summaries as absent", () => {
    const detail = formatApprovalDetailText({
      message: undefined,
      question: undefined,
      toolParamsDisplay: undefined,
      parameterSummary: "{}",
      options: [],
      patterns: [RM_PATH],
      permissionName: "bash",
      toolName: "bash",
    });

    expect(detail).toBe(RM_PATH);
  });

  it("falls back to permission/tool identity when no other details exist", () => {
    const detail = formatApprovalDetailText({
      message: undefined,
      question: undefined,
      toolParamsDisplay: undefined,
      parameterSummary: undefined,
      options: [],
      patterns: [],
      permissionName: "bash",
      toolName: "bash",
      toolUseId: "functions.bash:39",
    });

    expect(detail).toContain("bash");
    expect(detail).toContain("functions.bash:39");
    expect(detail).not.toBe("Manual approval is required.");
  });

  it("preserves existing message-based detail rendering", () => {
    const detail = formatApprovalDetailText({
      message: "Allow git status?",
      question: undefined,
      toolParamsDisplay: undefined,
      parameterSummary: undefined,
      options: [],
      patterns: [RM_PATH],
      permissionName: undefined,
      toolName: undefined,
    });

    expect(detail).toBe("Allow git status?");
  });
});

describe("buildApprovalLogicalKey collapses native id rotations", () => {
  it("matches across two events that differ only in permissionId", () => {
    const baseRequest = {
      adapter: "opencode",
      source: "permission.asked",
      options: [] as string[],
      patterns: [RM_PATH],
      toolName: "bash",
      toolUseId: "functions.bash:39",
      nativeSessionId: "ses_dd956e8140019cf3",
      permissionName: "bash",
    };
    const context = {
      sessionId: "term-1777467128491-z9jcxs",
      beatId: "knots-9aa6",
      repoPath: "/Users/cartine/knots",
    };

    const a = buildApprovalLogicalKey({
      ...baseRequest,
      permissionId: "per_dd956e814001",
      requestId: "per_dd956e814001",
    }, context);
    const b = buildApprovalLogicalKey({
      ...baseRequest,
      permissionId: "per_dd956e822001",
      requestId: "per_dd956e822001",
    }, context);

    expect(a).toBe(b);
    const escalationA = approvalEscalationFromRequest(
      {
        ...baseRequest,
        permissionId: "per_dd956e814001",
        requestId: "per_dd956e814001",
      },
      { ...context, timestamp: 1 },
    );
    const escalationB = approvalEscalationFromRequest(
      {
        ...baseRequest,
        permissionId: "per_dd956e822001",
        requestId: "per_dd956e822001",
      },
      { ...context, timestamp: 2 },
    );
    expect(escalationA.id).toBe(escalationB.id);
    expect(escalationA.logicalKey).toBe(escalationB.logicalKey);
  });
});
