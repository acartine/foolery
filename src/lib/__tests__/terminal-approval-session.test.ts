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
import type {
  AgentSessionRuntime,
} from "@/lib/agent-session-runtime";
import {
  attachApprovalResponder,
  performApprovalAction,
  recordPendingApproval,
} from "@/lib/terminal-approval-session";
import {
  clearApprovalRegistry,
  getApproval,
  listApprovals,
} from "@/lib/approval-registry";
import {
  cleanupTerminalSessionResources,
} from "@/lib/terminal-session-cleanup";
import {
  getTerminalSessions,
} from "@/lib/terminal-session-registry";

beforeEach(() => {
  clearApprovalRegistry();
  getTerminalSessions().clear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  clearApprovalRegistry();
  getTerminalSessions().clear();
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
});

describe("terminal approval session responder routing", () => {
  it("routes Codex approval replies through JSON-RPC", async () => {
    const entry = makeEntry();
    const respondToApproval = vi.fn()
      .mockResolvedValue({ ok: true });
    attachApprovalResponder(
      entry,
      {
        config: {
          jsonrpcSession: { respondToApproval },
        },
      } as unknown as AgentSessionRuntime,
    );
    const record = recordPendingApproval(entry, {
      adapter: "codex",
      source: "mcpServer/elicitation/request",
      options: [],
      requestId: "44",
      supportedActions: ["approve", "reject"],
      replyTarget: {
        adapter: "codex",
        transport: "jsonrpc",
        requestId: "44",
      },
    });

    const result = await performApprovalAction(
      entry,
      record.approvalId,
      "approve",
    );

    expect(result.ok).toBe(true);
    expect(record.status).toBe("approved");
    expect(respondToApproval).toHaveBeenCalledWith(
      record.replyTarget,
      "approve",
    );
  });

  it("marks Claude bridge approvals after UI action", async () => {
    const entry = makeEntry();
    attachApprovalResponder(
      entry,
      { config: {} } as unknown as AgentSessionRuntime,
    );
    const record = recordPendingApproval(entry, {
      adapter: "claude",
      source: "permission-prompt-tool",
      options: [],
      toolName: "Bash",
      supportedActions: ["approve", "reject"],
      replyTarget: {
        adapter: "claude-bridge",
        transport: "stdio",
        requestId: "toolu_1",
      },
    });

    const result = await performApprovalAction(
      entry,
      record.approvalId,
      "approve",
    );

    expect(result.ok).toBe(true);
    expect(record.status).toBe("approved");
  });
});

describe("registry survives session cleanup", () => {
  it("keeps records visible with actionable=false after cleanup", () => {
    const entry = makeEntry();
    getTerminalSessions().set(entry.session.id, entry);
    const record = recordPendingApproval(entry, {
      adapter: "opencode",
      source: "permission.asked",
      options: [],
      nativeSessionId: "ses_1",
      requestId: "perm_1",
      permissionId: "perm_1",
      supportedActions: ["approve", "reject"],
      replyTarget: {
        adapter: "opencode",
        transport: "http",
        nativeSessionId: "ses_1",
        permissionId: "perm_1",
      },
    });
    expect(getApproval(record.approvalId)).toBeDefined();

    cleanupTerminalSessionResources(
      entry.session.id, "session_aborted",
    );

    expect(
      getTerminalSessions().has(entry.session.id),
    ).toBe(false);
    const dtos = listApprovals();
    expect(dtos).toHaveLength(1);
    expect(dtos[0]?.id).toBe(record.approvalId);
    expect(dtos[0]?.status).toBe("manual_required");
    expect(dtos[0]?.actionable).toBe(false);
    expect(dtos[0]?.actionableReason).toBe(
      "approval_responder_unavailable",
    );
  });
});

describe("terminal approval session failure paths", () => {
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
