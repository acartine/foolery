import type {
  AgentSessionRuntime,
} from "@/lib/agent-session-runtime";
import {
  approvalEscalationFromRequest,
  logApprovalEscalation,
} from "@/lib/approval-escalations";
import type {
  ApprovalRequest,
} from "@/lib/approval-request-visibility";
import {
  approvalStatusForAction,
  isTerminalApprovalStatus,
  normalizeSupportedActions,
  type ApprovalAction,
  type ApprovalReplyResult,
  type PendingApprovalRecord,
} from "@/lib/approval-actions";
import {
  attachResponderForSession,
  getApproval,
  registerApproval,
  type ApprovalResponder,
} from "@/lib/approval-registry";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import type { TerminalEvent } from "@/lib/types";
import type { ExecutionAgentInfo } from "@/lib/execution-port";

interface ApprovalActionExecution {
  ok: boolean;
  httpStatus: number;
  record?: PendingApprovalRecord;
  error?: string;
  code?: string;
}

const MAX_BUFFER = 5_000;

export function createApprovalRequestHandler(
  entry: SessionEntry,
): (request: ApprovalRequest) => void {
  return (request) => {
    recordPendingApproval(entry, request);
  };
}

export function attachApprovalResponder(
  entry: SessionEntry,
  runtime: AgentSessionRuntime,
): void {
  const responder: ApprovalResponder = (record, action) =>
    respondWithRuntime(runtime, record, action);
  entry.approvalResponder = responder;
  attachResponderForSession(
    entry.session.id,
    responder,
    agentInfoFromEntry(entry),
  );
}

export function recordPendingApproval(
  entry: SessionEntry,
  request: ApprovalRequest,
): PendingApprovalRecord {
  // Approval rows show "who is being asked for approval" — that's the
  // agent currently running this session, which is the bound lease's
  // agent_info.  We read it from `entry.knotsLeaseAgentInfo` (mirrored
  // onto the session as `knotsAgentInfo` for HTTP consumers).  See
  // `docs/knots-agent-identity-contract.md` rule 5.
  const leaseInfo = entry.knotsLeaseAgentInfo;
  const approval = approvalEscalationFromRequest(
    request,
    {
      sessionId: entry.session.id,
      beatId: entry.session.beatId,
      beatTitle: entry.session.beatTitle,
      repoPath: entry.session.repoPath,
      agentName: leaseInfo?.agentName,
      agentModel: leaseInfo?.agentModel,
      agentVersion: leaseInfo?.agentVersion,
      agentCommand: leaseInfo?.agentName,
    },
  );
  const record = pendingRecordFromApproval(approval);
  entry.pendingApprovals ??= new Map();
  const existing = entry.pendingApprovals.get(record.approvalId);
  if (existing) {
    existing.updatedAt = record.updatedAt;
    if (!isTerminalApprovalStatus(existing.status)) {
      existing.supportedActions = record.supportedActions;
      existing.replyTarget = record.replyTarget;
      existing.requestId = record.requestId ?? existing.requestId;
      existing.permissionId =
        record.permissionId ?? existing.permissionId;
      if (record.parameterSummary) {
        existing.parameterSummary = record.parameterSummary;
      }
      if (record.toolParamsDisplay) {
        existing.toolParamsDisplay = record.toolParamsDisplay;
      }
      if (record.patterns.length > 0) {
        existing.patterns = record.patterns;
      }
      existing.agentName = record.agentName ?? existing.agentName;
      existing.agentModel =
        record.agentModel ?? existing.agentModel;
      existing.agentVersion =
        record.agentVersion ?? existing.agentVersion;
      existing.agentCommand =
        record.agentCommand ?? existing.agentCommand;
    }
    registerApproval({
      sessionId: entry.session.id,
      record: existing,
      responder: entry.approvalResponder ?? null,
      agentInfo: agentInfoFromEntry(entry),
    });
    logApprovalEscalation(
      "approval.pending_duplicate_refreshed",
      logContext(existing),
    );
    return existing;
  }
  entry.pendingApprovals.set(record.approvalId, record);
  registerApproval({
    sessionId: entry.session.id,
    record,
    responder: entry.approvalResponder ?? null,
    agentInfo: agentInfoFromEntry(entry),
  });
  logApprovalEscalation(
    "approval.pending_recorded",
    logContext(record),
  );
  return record;
}

export async function performApprovalAction(
  entry: SessionEntry,
  approvalId: string,
  action: ApprovalAction,
): Promise<ApprovalActionExecution> {
  const record = entry.pendingApprovals?.get(approvalId);
  if (!record) {
    return {
      ok: false,
      httpStatus: 404,
      error: "Approval request not found",
    };
  }
  return executeApprovalAction({
    record,
    responder: entry.approvalResponder ?? null,
    action,
    onFailureBanner: (failureRecord, reason) =>
      pushApprovalFailureEvent(entry, failureRecord, reason),
  });
}

export async function applyApprovalAction(
  approvalId: string,
  action: ApprovalAction,
): Promise<ApprovalActionExecution> {
  const entry = getApproval(approvalId);
  if (!entry) {
    return {
      ok: false,
      httpStatus: 404,
      error: "Approval request not found",
    };
  }
  return executeApprovalAction({
    record: entry.record,
    responder: entry.responder,
    action,
  });
}

interface ExecuteApprovalActionInput {
  record: PendingApprovalRecord;
  responder: ApprovalResponder | null | undefined;
  action: ApprovalAction;
  onFailureBanner?: (
    record: PendingApprovalRecord,
    reason?: string,
  ) => void;
}

async function executeApprovalAction(
  input: ExecuteApprovalActionInput,
): Promise<ApprovalActionExecution> {
  const { record, responder, action, onFailureBanner } = input;
  logApprovalEscalation(
    "approval.action_requested",
    logContext(record, action),
  );
  const unsupported = unsupportedReason(
    record,
    action,
    responder,
  );
  if (unsupported) {
    markUnsupported(record, action, unsupported);
    return {
      ok: false,
      httpStatus: 409,
      record,
      code: unsupported,
      error: `Approval action is not supported: ${unsupported}`,
    };
  }
  record.status = "responding";
  record.failureReason = undefined;
  record.updatedAt = Date.now();
  logApprovalEscalation(
    "approval.action_sent",
    logContext(record, action),
  );
  const result = await responder!(record, action);
  return finishApprovalReply(
    record,
    action,
    result,
    onFailureBanner,
  );
}

async function respondWithRuntime(
  runtime: AgentSessionRuntime,
  record: PendingApprovalRecord,
  action: ApprovalAction,
): Promise<ApprovalReplyResult> {
  const target = record.replyTarget;
  if (!target) {
    return {
      ok: false,
      status: "unsupported",
      reason: "missing_reply_target",
    };
  }
  if (
    target.adapter === "opencode" &&
    target.transport === "http"
  ) {
    const session = runtime.config.httpSession;
    if (!session) {
      return {
        ok: false,
        status: "unsupported",
        reason: "missing_http_session",
      };
    }
    return session.respondToApproval(target, action);
  }
  if (
    target.adapter === "codex" &&
    target.transport === "jsonrpc"
  ) {
    const session = runtime.config.jsonrpcSession;
    if (!session) {
      return {
        ok: false,
        status: "unsupported",
        reason: "missing_jsonrpc_session",
      };
    }
    return session.respondToApproval(target, action);
  }
  if (
    target.adapter === "claude-bridge" &&
    target.transport === "stdio"
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    status: "unsupported",
    reason: `unsupported_adapter:${target.adapter}`,
  };
}

function pendingRecordFromApproval(
  approval: ReturnType<typeof approvalEscalationFromRequest>,
): PendingApprovalRecord {
  return {
    approvalId: approval.id,
    notificationKey: approval.notificationKey,
    terminalSessionId: approval.sessionId,
    beatId: approval.beatId,
    beatTitle: approval.beatTitle,
    repoPath: approval.repoPath,
    adapter: approval.adapter,
    source: approval.source,
    message: approval.message,
    question: approval.question,
    serverName: approval.serverName,
    toolName: approval.toolName,
    toolParamsDisplay: approval.toolParamsDisplay,
    parameterSummary: approval.parameterSummary,
    toolUseId: approval.toolUseId,
    nativeSessionId: approval.nativeSessionId,
    requestId: approval.requestId,
    permissionId: approval.permissionId,
    permissionName: approval.permissionName,
    patterns: approval.patterns ?? [],
    options: approval.options,
    replyTarget: approval.replyTarget,
    supportedActions: normalizeSupportedActions(
      approval.supportedActions,
    ),
    status: approval.status,
    agentName: approval.agentName,
    agentModel: approval.agentModel,
    agentVersion: approval.agentVersion,
    agentCommand: approval.agentCommand,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
  };
}

function unsupportedReason(
  record: PendingApprovalRecord,
  action: ApprovalAction,
  responder: ApprovalResponder | null | undefined,
): string | null {
  if (!record.supportedActions.includes(action)) {
    return "approval_action_not_supported";
  }
  if (!record.replyTarget) {
    return "approval_reply_target_missing";
  }
  if (!responder) {
    return "approval_responder_unavailable";
  }
  return null;
}

function markUnsupported(
  record: PendingApprovalRecord,
  action: ApprovalAction,
  reason: string,
): void {
  record.status = "unsupported";
  record.failureReason = reason;
  record.updatedAt = Date.now();
  logApprovalEscalation(
    "approval.action_unsupported",
    logContext(record, action, reason),
  );
}

function finishApprovalReply(
  record: PendingApprovalRecord,
  action: ApprovalAction,
  result: ApprovalReplyResult,
  onFailureBanner?: (
    record: PendingApprovalRecord,
    reason?: string,
  ) => void,
): ApprovalActionExecution {
  if (!result.ok) {
    record.status = result.status === "unsupported"
      ? "unsupported"
      : "reply_failed";
    record.updatedAt = Date.now();
    const reason = result.reason ?? result.message;
    record.failureReason = reason;
    const eventName = record.status === "unsupported"
      ? "approval.action_unsupported"
      : "approval.reply_failed";
    logApprovalEscalation(
      eventName,
      logContext(record, action, reason),
    );
    onFailureBanner?.(record, reason);
    return {
      ok: false,
      httpStatus: record.status === "unsupported" ? 409 : 502,
      record,
      code: record.status === "unsupported"
        ? "approval_action_not_supported"
        : "approval_reply_failed",
      error: record.status === "unsupported"
        ? `Approval action is not supported: ${reason}`
        : reason ?? "Approval reply failed",
    };
  }
  record.status = approvalStatusForAction(action);
  record.failureReason = undefined;
  record.updatedAt = Date.now();
  logApprovalEscalation(
    "approval.action_resolved",
    logContext(record, action),
  );
  return { ok: true, httpStatus: 200, record };
}

function pushApprovalFailureEvent(
  entry: SessionEntry,
  record: PendingApprovalRecord,
  reason?: string,
): void {
  const evt: TerminalEvent = {
    type: "stderr",
    data:
      `\x1b[31m--- Approval reply failed for ` +
      `${record.approvalId}: ${reason ?? "unknown"} ---\x1b[0m\n`,
    timestamp: Date.now(),
  };
  if (entry.buffer.length >= MAX_BUFFER) entry.buffer.shift();
  entry.buffer.push(evt);
  entry.emitter.emit("data", evt);
}

function agentInfoFromEntry(
  entry: SessionEntry,
): ExecutionAgentInfo | undefined {
  // Always read canonical agent identity from the bound lease — never
  // from a parallel field on the session.  See contract rule 5.
  const lease = entry.knotsLeaseAgentInfo;
  if (!lease) return undefined;
  const info: ExecutionAgentInfo = {};
  if (lease.agentName) info.agentName = lease.agentName;
  if (lease.agentModel) info.agentModel = lease.agentModel;
  if (lease.agentVersion) info.agentVersion = lease.agentVersion;
  if (lease.agentProvider) info.agentProvider = lease.agentProvider;
  if (lease.agentType) info.agentType = lease.agentType;
  return Object.keys(info).length > 0 ? info : undefined;
}

function logContext(
  record: PendingApprovalRecord,
  action?: ApprovalAction,
  reason?: string,
) {
  return {
    approvalId: record.approvalId,
    notificationKey: record.notificationKey,
    sessionId: record.terminalSessionId,
    beatId: record.beatId,
    repoPath: record.repoPath,
    adapter: record.adapter,
    source: record.source,
    serverName: record.serverName,
    toolName: record.toolName,
    nativeSessionId: record.nativeSessionId,
    requestId: record.requestId,
    status: record.status,
    action,
    reason,
  };
}
