/**
 * Confirms POST /api/terminal/{sessionId}/approvals/{approvalId}
 * delegates to the canonical action implementation.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import {
  clearApprovalRegistry,
  registerApproval,
  type ApprovalResponder,
} from "@/lib/approval-registry";
import type { PendingApprovalRecord } from "@/lib/approval-actions";

const getSessionMock = vi.fn();

vi.mock("@/lib/terminal-manager", () => ({
  getSession: (id: string) => getSessionMock(id),
}));

import { POST } from
  "@/app/api/terminal/[sessionId]/approvals/[approvalId]/route";

beforeEach(() => {
  clearApprovalRegistry();
  getSessionMock.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearApprovalRegistry();
});

function makeRecord(): PendingApprovalRecord {
  return {
    approvalId: "approval-1",
    notificationKey: "key-1",
    terminalSessionId: "term-1",
    beatId: "beat-1",
    repoPath: "/repo",
    adapter: "opencode",
    source: "permission.asked",
    patterns: [],
    options: [],
    replyTarget: {
      adapter: "opencode",
      transport: "http",
      nativeSessionId: "ses_1",
      permissionId: "perm_1",
    },
    supportedActions: ["approve", "reject"],
    status: "pending",
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/terminal/term-1/approvals/approval-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    },
  );
}

const params = {
  params: Promise.resolve({
    sessionId: "term-1",
    approvalId: "approval-1",
  }),
};

describe("POST /api/terminal/{sessionId}/approvals/{approvalId}", () => {
  it("returns 404 when the session is unknown", async () => {
    getSessionMock.mockReturnValue(undefined);
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(404);
  });

  it("delegates to canonical action and returns the same payload shape", async () => {
    getSessionMock.mockReturnValue({});
    const responder: ApprovalResponder = vi.fn()
      .mockResolvedValue({ ok: true });
    const record = makeRecord();
    registerApproval({
      sessionId: "term-1", record, responder,
    });

    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      approvalId: "approval-1",
      action: "approve",
      status: "approved",
    });
    expect(record.status).toBe("approved");
  });
});
