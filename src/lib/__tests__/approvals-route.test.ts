/**
 * Integration coverage for GET /api/approvals.
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
} from "@/lib/approval-registry";
import type { PendingApprovalRecord } from "@/lib/approval-actions";
import { GET } from "@/app/api/approvals/route";

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
    approvalId: overrides.approvalId ?? "approval-1",
    notificationKey:
      overrides.notificationKey ?? "key-1",
    terminalSessionId:
      overrides.terminalSessionId ?? "term-1",
    beatId: overrides.beatId ?? "beat-1",
    repoPath: overrides.repoPath ?? "/repo",
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
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
  };
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/approvals: shape", () => {
  it("returns canonical records with display fields", async () => {
    registerApproval({
      sessionId: "term-1",
      record: makeRecord(),
      responder: vi.fn(),
      agentInfo: {
        agentName: "OpenCode",
        agentProvider: "opencode",
      },
    });
    const res = await GET(getRequest(
      "http://localhost/api/approvals",
    ));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    const dto = json.data[0];
    expect(dto.id).toBe("approval-1");
    expect(dto.actionable).toBe(true);
    expect(dto.supportedActions).toEqual([
      "approve",
      "reject",
    ]);
    expect(dto.agent.name).toBe("OpenCode");
  });
});

describe("GET /api/approvals: repo and cursor filters", () => {
  it("filters by repo path with _repo query param", async () => {
    registerApproval({
      sessionId: "term-1",
      record: makeRecord({ repoPath: "/repo-a" }),
      responder: vi.fn(),
    });
    registerApproval({
      sessionId: "term-2",
      record: makeRecord({
        approvalId: "approval-2",
        notificationKey: "key-2",
        repoPath: "/repo-b",
        updatedAt: 2_000,
      }),
      responder: vi.fn(),
    });

    const res = await GET(getRequest(
      "http://localhost/api/approvals?_repo=%2Frepo-b",
    ));
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("approval-2");
  });

  it("supports active=true and updatedSince cursor", async () => {
    registerApproval({
      sessionId: "term-1",
      record: makeRecord({
        status: "approved",
        updatedAt: 1_000,
      }),
      responder: vi.fn(),
    });
    registerApproval({
      sessionId: "term-2",
      record: makeRecord({
        approvalId: "approval-2",
        notificationKey: "key-2",
        status: "pending",
        updatedAt: 5_000,
      }),
      responder: vi.fn(),
    });

    const activeRes = await GET(getRequest(
      "http://localhost/api/approvals?active=true",
    ));
    const activeJson = await activeRes.json();
    expect(activeJson.data.map(
      (r: { id: string }) => r.id,
    )).toEqual(["approval-2"]);

    const cursorRes = await GET(getRequest(
      "http://localhost/api/approvals?updatedSince=2000",
    ));
    const cursorJson = await cursorRes.json();
    expect(cursorJson.data.map(
      (r: { id: string }) => r.id,
    )).toEqual(["approval-2"]);
  });
});

describe("GET /api/approvals: status filters", () => {
  it("supports repeated and CSV status filters", async () => {
    registerApproval({
      sessionId: "term-1",
      record: makeRecord({
        approvalId: "approval-pending",
        notificationKey: "k1",
      }),
      responder: vi.fn(),
    });
    registerApproval({
      sessionId: "term-2",
      record: makeRecord({
        approvalId: "approval-approved",
        notificationKey: "k2",
        status: "approved",
        updatedAt: 2_000,
      }),
      responder: vi.fn(),
    });
    registerApproval({
      sessionId: "term-3",
      record: makeRecord({
        approvalId: "approval-rejected",
        notificationKey: "k3",
        status: "rejected",
        updatedAt: 3_000,
      }),
      responder: vi.fn(),
    });

    const res = await GET(getRequest(
      "http://localhost/api/approvals?status=approved,rejected",
    ));
    const json = await res.json();
    expect(json.data.map(
      (r: { id: string }) => r.id,
    ).sort()).toEqual([
      "approval-approved",
      "approval-rejected",
    ]);
  });
});
