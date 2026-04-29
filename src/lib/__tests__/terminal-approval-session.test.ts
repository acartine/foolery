import { EventEmitter } from "node:events";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import {
  performApprovalAction,
  recordPendingApproval,
} from "@/lib/terminal-approval-session";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeEntry(): SessionEntry {
  return {
    session: {
      id: "term-1",
      beatId: "beat-1",
      beatTitle: "Approval beat",
      repoPath: "/repo",
      agentName: "OpenCode",
      status: "running",
      startedAt: "2026-04-29T12:00:00.000Z",
    },
    process: null,
    emitter: new EventEmitter(),
    buffer: [],
    interactionLog: {
      logStdout: vi.fn(),
      logStderr: vi.fn(),
      logResponse: vi.fn(),
      logPrompt: vi.fn(),
      logEnd: vi.fn(),
      logBeatState: vi.fn(),
      filePath: null,
    } as unknown as SessionEntry["interactionLog"],
  };
}

describe("terminal approval session", () => {
  it("stores OpenCode approvals with reply metadata", () => {
    const entry = makeEntry();

    const record = recordPendingApproval(entry, {
      adapter: "opencode",
      source: "permission.asked",
      options: [],
      nativeSessionId: "ses_1",
      requestId: "perm_1",
      permissionId: "perm_1",
      supportedActions: [
        "approve",
        "always_approve",
        "reject",
      ],
      replyTarget: {
        adapter: "opencode",
        transport: "http",
        nativeSessionId: "ses_1",
        permissionId: "perm_1",
      },
    });

    expect(entry.pendingApprovals?.get(record.approvalId))
      .toBe(record);
    expect(record.supportedActions).toEqual([
      "approve",
      "always_approve",
      "reject",
    ]);
    expect(record.nativeSessionId).toBe("ses_1");
  });

  it("resolves supported approval actions", async () => {
    const entry = makeEntry();
    const record = recordPendingApproval(entry, {
      adapter: "opencode",
      source: "permission.asked",
      options: [],
      nativeSessionId: "ses_1",
      requestId: "perm_1",
      permissionId: "perm_1",
      supportedActions: ["approve"],
      replyTarget: {
        adapter: "opencode",
        transport: "http",
        nativeSessionId: "ses_1",
        permissionId: "perm_1",
      },
    });
    entry.approvalResponder = vi.fn()
      .mockResolvedValue({ ok: true });

    const result = await performApprovalAction(
      entry,
      record.approvalId,
      "approve",
    );

    expect(result.ok).toBe(true);
    expect(record.status).toBe("approved");
    expect(entry.approvalResponder).toHaveBeenCalledWith(
      record,
      "approve",
    );
  });

  it("marks unsupported and failed reply paths", async () => {
    const entry = makeEntry();
    const record = recordPendingApproval(entry, {
      adapter: "codex",
      source: "mcpServer/elicitation/request",
      options: [],
    });

    const unsupported = await performApprovalAction(
      entry,
      record.approvalId,
      "approve",
    );
    expect(unsupported.ok).toBe(false);
    expect(record.status).toBe("unsupported");

    record.supportedActions = ["approve"];
    record.replyTarget = {
      adapter: "opencode",
      transport: "http",
      nativeSessionId: "ses_1",
      permissionId: "perm_1",
    };
    entry.approvalResponder = vi.fn()
      .mockResolvedValue({
        ok: false,
        reason: "network_down",
      });

    const failed = await performApprovalAction(
      entry,
      record.approvalId,
      "approve",
    );
    expect(failed.ok).toBe(false);
    expect(record.status).toBe("reply_failed");
    expect(entry.buffer[0]?.data).toContain("network_down");
  });
});
