/**
 * Integration coverage for POST /api/approvals/{approvalId}/actions.
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
  detachSession,
  registerApproval,
  type ApprovalResponder,
} from "@/lib/approval-registry";
import type { PendingApprovalRecord } from "@/lib/approval-actions";
import { POST } from
  "@/app/api/approvals/[approvalId]/actions/route";

beforeEach(() => {
  clearApprovalRegistry();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearApprovalRegistry();
});

function makeRecord(
  overrides: Partial<PendingApprovalRecord> = {},
): PendingApprovalRecord {
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
    supportedActions: [
      "approve",
      "always_approve",
      "reject",
    ],
    status: "pending",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/approvals/approval-1/actions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const params = (id: string) => ({
  params: Promise.resolve({ approvalId: id }),
});

describe("POST /api/approvals/{approvalId}/actions: happy paths", () => {
  it.each([
    ["approve", "approved"],
    ["always_approve", "always_approved"],
    ["reject", "rejected"],
  ])("%s -> status %s", async (action, expectedStatus) => {
    const responder: ApprovalResponder = vi.fn()
      .mockResolvedValue({ ok: true });
    const record = makeRecord();
    registerApproval({
      sessionId: "term-1", record, responder,
    });

    const res = await POST(
      makeRequest({ action }),
      params("approval-1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.action).toBe(action);
    expect(json.data.status).toBe(expectedStatus);
    expect(json.data.record.id).toBe("approval-1");
    expect(json.data.record.status).toBe(expectedStatus);
    expect(record.status).toBe(expectedStatus);
  });
});

describe("POST /api/approvals/{approvalId}/actions: failures", () => {
  it("returns 409 with code after detach", async () => {
    const record = makeRecord();
    registerApproval({
      sessionId: "term-1",
      record,
      responder: vi.fn(),
    });
    detachSession("term-1", "session_aborted");

    const res = await POST(
      makeRequest({ action: "approve" }),
      params("approval-1"),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("approval_responder_unavailable");
    expect(json.record).toBeDefined();
    expect(json.record.id).toBe("approval-1");
  });

  it("returns 404 for unknown approval", async () => {
    const res = await POST(
      makeRequest({ action: "approve" }),
      params("approval-missing"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid action", async () => {
    registerApproval({
      sessionId: "term-1",
      record: makeRecord(),
      responder: vi.fn(),
    });
    const res = await POST(
      makeRequest({ action: "destroy_everything" }),
      params("approval-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 502 when responder fails non-fatally", async () => {
    const responder: ApprovalResponder = vi.fn()
      .mockResolvedValue({ ok: false, reason: "network_down" });
    registerApproval({
      sessionId: "term-1",
      record: makeRecord(),
      responder,
    });

    const res = await POST(
      makeRequest({ action: "approve" }),
      params("approval-1"),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(String(json.error)).toContain("network_down");
  });
});
