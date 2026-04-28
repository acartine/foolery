import { describe, expect, it, vi } from "vitest";
import {
  approvalEscalationFromBanner,
  buildApprovalConsoleHref,
  buildApprovalsHref,
  logApprovalEscalation,
  parseApprovalBanner,
} from "@/lib/approval-escalations";

describe("approval escalations", () => {
  const banner = [
    "\u001b[1;31mFOOLERY APPROVAL REQUIRED\u001b[0m",
    "adapter=codex",
    "source=mcpServer/elicitation/request",
    "serverName=playwright",
    "toolName=browser_evaluate",
    "message=Allow browser_evaluate?",
    "toolParamsDisplay=pageFunction=document.title()",
  ].join("\n");

  it("parses formatted approval banners into request fields", () => {
    const request = parseApprovalBanner(banner);

    expect(request).toMatchObject({
      adapter: "codex",
      source: "mcpServer/elicitation/request",
      serverName: "playwright",
      toolName: "browser_evaluate",
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
