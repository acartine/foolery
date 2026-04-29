import {
  APPROVAL_REQUIRED_MARKER,
  type ApprovalRequest,
} from "@/lib/approval-request-visibility";
import {
  isApprovalAction,
  normalizeSupportedActions,
  type ApprovalAction,
  type ApprovalEscalationStatus,
  type PendingApprovalRecord,
  type ApprovalReplyTarget,
} from "@/lib/approval-actions";

export type {
  ApprovalEscalationStatus,
} from "@/lib/approval-actions";

export const APPROVAL_ESCALATION_LOG_MARKER =
  "FOOLERY APPROVAL ESCALATION";

export interface ApprovalEscalationAgentIdentity {
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  agentCommand?: string;
}

export interface ApprovalEscalationContext
  extends ApprovalEscalationAgentIdentity {
  sessionId: string;
  beatId?: string;
  beatTitle?: string;
  repoPath?: string;
  timestamp?: number;
}

export interface ApprovalEscalation
  extends ApprovalRequest, ApprovalEscalationAgentIdentity {
  id: string;
  notificationKey: string;
  logicalKey: string;
  status: ApprovalEscalationStatus;
  sessionId: string;
  beatId?: string;
  beatTitle?: string;
  repoPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalEscalationLogContext {
  approvalId?: string;
  notificationKey?: string;
  sessionId?: string;
  beatId?: string;
  repoPath?: string;
  adapter?: string;
  source?: string;
  serverName?: string;
  toolName?: string;
  status?: ApprovalEscalationStatus;
  action?: ApprovalAction;
  nativeSessionId?: string;
  requestId?: string;
  reason?: string;
  error?: string;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function buildApprovalsHref(repoPath?: string): string {
  const params = new URLSearchParams();
  params.set("view", "finalcut");
  params.set("tab", "approvals");
  if (repoPath) params.set("repo", repoPath);
  return `/beats?${params.toString()}`;
}

export function buildApprovalConsoleHref(
  approval: Pick<ApprovalEscalation, "beatId" | "repoPath">,
): string | null {
  if (!approval.beatId) return null;
  const params = new URLSearchParams();
  params.set("view", "history");
  params.set("beat", approval.beatId);
  if (approval.repoPath) {
    params.set("repo", approval.repoPath);
    params.set("detailRepo", approval.repoPath);
  }
  return `/beats?${params.toString()}`;
}

export function formatApprovalPrimaryText(
  approval: Pick<ApprovalEscalation, "toolName" | "serverName" | "adapter">,
): string {
  if (approval.toolName && approval.serverName) {
    return `${approval.serverName} / ${approval.toolName}`;
  }
  return approval.toolName ?? approval.serverName ?? approval.adapter;
}

const RAW_EMPTY_OBJECT_PATTERN = /^\s*\{\s*\}\s*$/;
const RAW_EMPTY_ARRAY_PATTERN = /^\s*\[\s*\]\s*$/;

function meaningfulSummary(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (RAW_EMPTY_OBJECT_PATTERN.test(trimmed)) return undefined;
  if (RAW_EMPTY_ARRAY_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function formatApprovalDetailText(
  approval: Pick<
    ApprovalEscalation,
    "message" | "question" | "toolParamsDisplay" | "parameterSummary"
      | "options" | "patterns" | "permissionName" | "toolName"
      | "toolUseId"
  >,
): string {
  const direct = meaningfulSummary(approval.message)
    ?? meaningfulSummary(approval.question)
    ?? meaningfulSummary(approval.toolParamsDisplay)
    ?? meaningfulSummary(approval.parameterSummary);
  if (direct) return direct;
  const meaningfulPatterns = (approval.patterns ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
  if (meaningfulPatterns.length > 0) {
    return meaningfulPatterns.join(" | ");
  }
  if (approval.options.length > 0) {
    return `Options: ${approval.options.join(" | ")}`;
  }
  const identityParts = [
    approval.permissionName,
    approval.toolName,
    approval.toolUseId,
  ].filter((part): part is string => Boolean(part?.trim()));
  if (identityParts.length > 0) {
    return `Awaiting approval for ${identityParts.join(" / ")}`;
  }
  return "Manual approval is required.";
}

export function parseApprovalBanner(
  data: string,
): ApprovalRequest | null {
  const clean = stripAnsi(data);
  if (!clean.includes(APPROVAL_REQUIRED_MARKER)) {
    return null;
  }
  const entries = new Map<string, string>();
  for (const rawLine of clean.split("\n")) {
    const line = rawLine.trim();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    entries.set(
      line.slice(0, separator),
      line.slice(separator + 1),
    );
  }
  const adapter = entries.get("adapter")?.trim() || "unknown";
  const source = entries.get("source")?.trim() || "terminal";
  const options = entries.get("options")
    ?.split("|")
    .map((option) => option.trim())
    .filter(Boolean) ?? [];
  const supportedActions = entries.get("supportedActions")
    ?.split("|")
    .map((action) => action.trim())
    .filter(isApprovalAction) ?? [];
  const patterns = entries.get("patterns")
    ?.split("|")
    .map((pattern) => pattern.trim())
    .filter(Boolean) ?? [];
  return {
    adapter,
    source,
    message: entries.get("message"),
    question: entries.get("question"),
    options,
    serverName: entries.get("serverName"),
    toolName: entries.get("toolName"),
    toolParamsDisplay: entries.get("toolParamsDisplay"),
    parameterSummary: entries.get("parameterSummary"),
    toolUseId: entries.get("toolUseId"),
    nativeSessionId:
      entries.get("nativeSessionId") ?? entries.get("sessionId"),
    sessionId: entries.get("sessionId"),
    requestId: entries.get("requestId"),
    permissionId: entries.get("permissionId"),
    permissionName: entries.get("permissionName"),
    patterns,
    supportedActions,
  };
}

export function approvalEscalationFromBanner(
  data: string,
  context: ApprovalEscalationContext,
): ApprovalEscalation | null {
  const request = parseApprovalBanner(data);
  if (!request) return null;
  return approvalEscalationFromRequest(request, context);
}

export function approvalEscalationFromRequest(
  request: ApprovalRequest,
  context: ApprovalEscalationContext,
): ApprovalEscalation {
  const now = context.timestamp ?? Date.now();
  const normalizedRequest: ApprovalRequest = {
    ...request,
    nativeSessionId:
      request.nativeSessionId ?? request.sessionId,
    supportedActions: normalizeSupportedActions(
      request.supportedActions,
    ),
  };
  const logicalKey = buildApprovalLogicalKey(
    normalizedRequest,
    context,
  );
  const notificationKey = buildApprovalNotificationKey(
    normalizedRequest,
    context,
  );
  return {
    ...normalizedRequest,
    id: shortHash(logicalKey),
    notificationKey,
    logicalKey,
    status: "pending",
    sessionId: context.sessionId,
    beatId: context.beatId,
    beatTitle: context.beatTitle,
    repoPath: context.repoPath,
    agentName: context.agentName,
    agentModel: context.agentModel,
    agentVersion: context.agentVersion,
    agentCommand: context.agentCommand,
    createdAt: now,
    updatedAt: now,
  };
}

export function approvalEscalationFromPendingRecord(
  record: PendingApprovalRecord,
): ApprovalEscalation {
  const logicalKey = record.notificationKey;
  return {
    id: record.approvalId,
    notificationKey: record.notificationKey,
    logicalKey,
    status: record.status,
    sessionId: record.terminalSessionId,
    beatId: record.beatId,
    beatTitle: record.beatTitle,
    repoPath: record.repoPath,
    adapter: record.adapter,
    source: record.source,
    message: record.message,
    question: record.question,
    options: record.options,
    serverName: record.serverName,
    toolName: record.toolName,
    toolParamsDisplay: record.toolParamsDisplay,
    parameterSummary: record.parameterSummary,
    toolUseId: record.toolUseId,
    nativeSessionId: record.nativeSessionId,
    requestId: record.requestId,
    permissionId: record.permissionId,
    permissionName: record.permissionName,
    patterns: record.patterns,
    supportedActions: normalizeSupportedActions(
      record.supportedActions,
    ),
    replyTarget: record.replyTarget,
    agentName: record.agentName,
    agentModel: record.agentModel,
    agentVersion: record.agentVersion,
    agentCommand: record.agentCommand,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function logApprovalEscalation(
  eventName: string,
  context: ApprovalEscalationLogContext,
): void {
  console.info(JSON.stringify({
    marker: APPROVAL_ESCALATION_LOG_MARKER,
    eventName,
    ...context,
  }));
}

/**
 * Stable identity for the same logical tool-use approval request,
 * even when an upstream adapter rotates a per-event permission id.
 * Excludes requestId/permissionId so two OpenCode permission.asked
 * events for the same toolUseId/patterns collapse to one row.
 */
export function buildApprovalLogicalKey(
  request: ApprovalRequest,
  context: Pick<ApprovalEscalationContext, "repoPath" | "beatId" | "sessionId">,
): string {
  return [
    context.repoPath ?? "",
    context.beatId ?? "",
    context.sessionId,
    request.adapter,
    request.source,
    request.serverName ?? "",
    request.toolName ?? "",
    request.toolUseId ?? "",
    request.nativeSessionId ?? request.sessionId ?? "",
    request.permissionName ?? "",
    request.patterns?.join("|") ?? "",
    request.options.join("|"),
  ].join(" ");
}

function buildApprovalNotificationKey(
  request: ApprovalRequest,
  context: ApprovalEscalationContext,
): string {
  return buildApprovalLogicalKey(request, context);
}

export function mergeApprovalReplyTarget(
  current: ApprovalReplyTarget | undefined,
  next: ApprovalReplyTarget | undefined,
): ApprovalReplyTarget | undefined {
  if (!next) return current;
  if (!current) return next;
  return {
    ...current,
    ...next,
  };
}

function shortHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `approval-${(hash >>> 0).toString(16)}`;
}
