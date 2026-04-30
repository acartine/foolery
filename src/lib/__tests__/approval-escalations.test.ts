import { describe, expect, it, vi } from "vitest";
import {
  approvalEscalationFromBanner,
  approvalEscalationFromPendingRecord,
  buildApprovalConsoleHref,
  buildApprovalsHref,
  explainApprovalFailureReason,
  logApprovalEscalation,
  parseApprovalBanner,
} from "@/lib/approval-escalations";

const banner = [
  "\u001b[1;31mFOOLERY APPROVAL REQUIRED\u001b[0m",
  "adapter=codex",
  "source=mcpServer/elicitation/request",
  "serverName=playwright",
  "toolName=browser_evaluate",
  "supportedActions=approve | reject",
  "nativeSessionId=native-session-1",
  "requestId=request-1",
  "message=Allow browser_evaluate?",
  "toolParamsDisplay=pageFunction=document.title()",
].join("\n");

describe("approval escalations", () => {
  it("parses formatted approval banners into request fields", () => {
    const request = parseApprovalBanner(banner);

    expect(request).toMatchObject({
      adapter: "codex",
      source: "mcpServer/elicitation/request",
      serverName: "playwright",
      toolName: "browser_evaluate",
      supportedActions: ["approve", "reject"],
      nativeSessionId: "native-session-1",
      requestId: "request-1",
      message: "Allow browser_evaluate?",
      toolParamsDisplay: "pageFunction=document.title()",
    });
  });

  it("builds stable approval identities with session and beat context", () => {
    const first = approvalEscalationFromBanner(banner, {
      sessionId: "sess-1",
      beatId: "beat-1",
      repoPath: "/repo",
      timestamp: 10,
    });
    const second = approvalEscalationFromBanner(banner, {
      sessionId: "sess-1",
      beatId: "beat-1",
      repoPath: "/repo",
      timestamp: 20,
    });

    expect(first?.id).toBe(second?.id);
    expect(first?.notificationKey).toBe(second?.notificationKey);
    expect(first?.createdAt).toBe(10);
  });

  it("builds links to approvals and history contexts", () => {
    expect(buildApprovalsHref("/repo")).toBe(
      "/beats?view=finalcut&tab=approvals&repo=%2Frepo",
    );
    expect(buildApprovalConsoleHref({
      beatId: "beat-1",
      repoPath: "/repo",
    })).toBe(
      "/beats?view=history&beat=beat-1&repo=%2Frepo&detailRepo=%2Frepo",
    );
  });

  it("writes structured approval logs with a stable marker", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logApprovalEscalation("approval.detected", {
      approvalId: "approval-1",
      sessionId: "sess-1",
    });

    const parsed = JSON.parse(spy.mock.calls[0]![0]);
    expect(parsed).toMatchObject({
      marker: "FOOLERY APPROVAL ESCALATION",
      eventName: "approval.detected",
      approvalId: "approval-1",
      sessionId: "sess-1",
    });
    spy.mockRestore();
  });
});

describe("approval escalation hydration", () => {
  it("hydrates pending approval records back into escalations", () => {
    const approval = approvalEscalationFromPendingRecord({
      approvalId: "approval-1",
      notificationKey: "key-1",
      terminalSessionId: "term-1",
      beatId: "beat-1",
      repoPath: "/repo",
      adapter: "opencode",
      source: "permission.asked",
      message: "Allow bash?",
      toolName: "bash",
      nativeSessionId: "ses_1",
      requestId: "perm_1",
      permissionId: "perm_1",
      patterns: ["mkdir -p .approval-validation"],
      options: [],
      supportedActions: ["approve", "reject"],
      status: "reply_failed",
      failureReason: "opencode_http_404",
      createdAt: 10,
      updatedAt: 20,
    });

    expect(approval).toMatchObject({
      id: "approval-1",
      notificationKey: "key-1",
      sessionId: "term-1",
      adapter: "opencode",
      source: "permission.asked",
      message: "Allow bash?",
      toolName: "bash",
      supportedActions: ["approve", "reject"],
      failureReason: "opencode_http_404",
      createdAt: 10,
      updatedAt: 20,
    });
  });
});

describe("explainApprovalFailureReason", () => {
  it.each([
    ["missing_reply_target", "no longer connected"],
    ["missing_opencode_reply_target", "no longer connected"],
    ["opencode_http_404", "no longer recognises"],
    ["opencode_http_410", "no longer recognises"],
    ["opencode_http_502", "server error"],
    ["opencode_returned_false", "rejected the reply"],
    ["The user aborted a request.", "did not respond"],
    ["fetch failed", "Could not reach"],
    ["ECONNREFUSED 127.0.0.1:7711", "Could not reach"],
    ["unsupported_adapter:claude-bridge", "claude-bridge"],
  ])("maps %s to a friendly hint", (input, fragment) => {
    const out = explainApprovalFailureReason(input);
    expect(out).toBeTruthy();
    expect(out!.toLowerCase())
      .toContain(fragment.toLowerCase());
  });

  it("returns null for unknown or empty reasons", () => {
    expect(explainApprovalFailureReason(undefined)).toBeNull();
    expect(explainApprovalFailureReason("")).toBeNull();
    expect(explainApprovalFailureReason("   ")).toBeNull();
    expect(explainApprovalFailureReason("brand new error"))
      .toBeNull();
  });
});
