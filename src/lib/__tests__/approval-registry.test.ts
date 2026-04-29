/**
 * Hermetic coverage for the canonical approval registry.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  attachResponderForSession,
  clearApprovalRegistry,
  detachSession,
  getApproval,
  listApprovals,
  registerApproval,
  type ApprovalResponder,
} from "@/lib/approval-registry";
import { applyApprovalAction } from "@/lib/terminal-approval-session";
import type {
  PendingApprovalRecord,
} from "@/lib/approval-actions";

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
    adapter: overrides.adapter ?? "opencode",
    source: overrides.source ?? "permission.asked",
    message: overrides.message,
    question: overrides.question,
    serverName: overrides.serverName,
    toolName: overrides.toolName ?? "Bash",
    toolParamsDisplay: overrides.toolParamsDisplay,
    parameterSummary: overrides.parameterSummary,
    toolUseId: overrides.toolUseId,
    nativeSessionId: overrides.nativeSessionId ?? "ses_1",
    requestId: overrides.requestId ?? "req_1",
    permissionId: overrides.permissionId ?? "perm_1",
    permissionName: overrides.permissionName,
    patterns: overrides.patterns ?? [],
    options: overrides.options ?? [],
    replyTarget: overrides.replyTarget ?? {
      adapter: "opencode",
      transport: "http",
      nativeSessionId: "ses_1",
      permissionId: "perm_1",
    },
    supportedActions: overrides.supportedActions ?? [
      "approve",
      "reject",
    ],
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
  };
}

describe("approval registry: register and list shape", () => {
  it("returns the canonical DTO with all display fields", () => {
    const record = makeRecord({ updatedAt: 5_000 });
    const responder: ApprovalResponder = vi.fn()
      .mockResolvedValue({ ok: true });
    registerApproval({
      sessionId: "term-1",
      record,
      responder,
      agentInfo: {
        agentName: "OpenCode",
        agentProvider: "opencode",
        agentModel: "gpt-5",
        agentVersion: "1.2.3",
      },
    });

    const [dto] = listApprovals();

    expect(dto.id).toBe("approval-1");
    expect(dto.notificationKey).toBe("key-1");
    expect(dto.status).toBe("pending");
    expect(dto.createdAt).toBe(1_000);
    expect(dto.updatedAt).toBe(5_000);
    expect(dto.repoPath).toBe("/repo");
    expect(dto.beatId).toBe("beat-1");
    expect(dto.sessionId).toBe("term-1");
    expect(dto.adapter).toBe("opencode");
    expect(dto.source).toBe("permission.asked");
    expect(dto.toolName).toBe("Bash");
    expect(dto.replyTarget?.transport).toBe("http");
    expect(dto.supportedActions).toEqual([
      "approve",
      "reject",
    ]);
    expect(dto.actionable).toBe(true);
    expect(dto.actionableReason).toBeUndefined();
    expect(dto.agent).toEqual({
      provider: "opencode",
      name: "OpenCode",
      model: "gpt-5",
      version: "1.2.3",
    });
  });
});

describe("approval registry: filters and ordering", () => {
  beforeEach(() => {
    registerApproval({
      sessionId: "term-1",
      record: makeRecord({
        approvalId: "approval-aaa",
        repoPath: "/repo-a",
        status: "pending",
        updatedAt: 1_000,
      }),
      responder: vi.fn(),
    });
    registerApproval({
      sessionId: "term-2",
      record: makeRecord({
        approvalId: "approval-bbb",
        repoPath: "/repo-b",
        status: "approved",
        updatedAt: 3_000,
      }),
      responder: vi.fn(),
    });
    registerApproval({
      sessionId: "term-3",
      record: makeRecord({
        approvalId: "approval-ccc",
        repoPath: "/repo-a",
        status: "rejected",
        updatedAt: 3_000,
      }),
      responder: vi.fn(),
    });
  });

  it("filters by repoPath", () => {
    const records = listApprovals({ repoPath: "/repo-a" });
    expect(records.map((r) => r.id)).toEqual([
      "approval-ccc",
      "approval-aaa",
    ]);
  });

  it("filters active-only and orders updatedAt desc, id asc", () => {
    const records = listApprovals({ activeOnly: true });
    expect(records.map((r) => r.id)).toEqual(["approval-aaa"]);
  });

  it("filters by status array", () => {
    const records = listApprovals({
      status: ["approved", "rejected"],
    });
    expect(records.map((r) => r.id).sort()).toEqual([
      "approval-bbb",
      "approval-ccc",
    ]);
  });

  it("filters by updatedSince cursor", () => {
    const records = listApprovals({ updatedSince: 2_500 });
    expect(records.map((r) => r.id).sort()).toEqual([
      "approval-bbb",
      "approval-ccc",
    ]);
  });
});

describe("approval registry: detach keeps record visible", () => {
  it("flips status to manual_required and actionable=false", () => {
    const record = makeRecord();
    registerApproval({
      sessionId: "term-1",
      record,
      responder: vi.fn(),
    });

    detachSession("term-1", "session_aborted");

    const [dto] = listApprovals();
    expect(dto.status).toBe("manual_required");
    expect(dto.actionable).toBe(false);
    expect(dto.actionableReason).toBe(
      "approval_responder_unavailable",
    );
    expect(getApproval("approval-1")?.responder).toBeNull();
  });
});

describe("applyApprovalAction via canonical registry path", () => {
  it("delegates to responder and updates status", async () => {
    const responder: ApprovalResponder = vi.fn()
      .mockResolvedValue({ ok: true });
    const record = makeRecord({
      supportedActions: [
        "approve",
        "always_approve",
        "reject",
      ],
    });
    registerApproval({
      sessionId: "term-1", record, responder,
    });

    const approve = await applyApprovalAction(
      "approval-1", "approve",
    );
    expect(approve.ok).toBe(true);
    expect(record.status).toBe("approved");
    expect(responder).toHaveBeenCalledWith(record, "approve");
  });

  it("returns 409 with code approval_responder_unavailable after detach", async () => {
    const record = makeRecord();
    registerApproval({
      sessionId: "term-1",
      record,
      responder: vi.fn(),
    });
    detachSession("term-1", "session_aborted");

    const result = await applyApprovalAction(
      "approval-1", "approve",
    );
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.code).toBe(
      "approval_responder_unavailable",
    );
    expect(getApproval("approval-1")).toBeDefined();
  });

  it("returns 404 for unknown approval", async () => {
    const result = await applyApprovalAction(
      "approval-missing", "approve",
    );
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });

  it("treats reattached responder as actionable again", async () => {
    const record = makeRecord();
    registerApproval({
      sessionId: "term-1",
      record,
      responder: null,
    });
    expect(getApproval("approval-1")?.responder).toBeNull();

    const responder: ApprovalResponder = vi.fn()
      .mockResolvedValue({ ok: true });
    attachResponderForSession("term-1", responder);

    const approve = await applyApprovalAction(
      "approval-1", "approve",
    );
    expect(approve.ok).toBe(true);
    expect(record.status).toBe("approved");
  });
});
