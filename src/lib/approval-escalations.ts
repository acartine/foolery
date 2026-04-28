import {
  APPROVAL_REQUIRED_MARKER,
  type ApprovalRequest,
} from "@/lib/approval-request-visibility";

export const APPROVAL_ESCALATION_LOG_MARKER =
  "FOOLERY APPROVAL ESCALATION";

export type ApprovalEscalationStatus =
  | "pending"
  | "manual_required"
  | "dismissed";

export interface ApprovalEscalationContext {
  sessionId: string;
  beatId?: string;
  beatTitle?: string;
  repoPath?: string;
  timestamp?: number;
}

export interface ApprovalEscalation extends ApprovalRequest {
  id: string;
  notificationKey: string;
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
  reason?: string;
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

export function formatApprovalDetailText(
  approval: Pick<
    ApprovalEscalation,
    "message" | "question" | "toolParamsDisplay" | "parameterSummary"
      | "options"
  >,
): string {
  return approval.message
    ?? approval.question
    ?? approval.toolParamsDisplay
    ?? approval.parameterSummary
    ?? (approval.options.length > 0
      ? `Options: ${approval.options.join(" | ")}`
      : "Manual approval is required.");
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
  };
}

export function approvalEscalationFromBanner(
  data: string,
  context: ApprovalEscalationContext,
): ApprovalEscalation | null {
  const request = parseApprovalBanner(data);
  if (!request) return null;
  const now = context.timestamp ?? Date.now();
  const notificationKey = buildApprovalNotificationKey(
    request,
    context,
  );
  return {
    ...request,
    id: shortHash(notificationKey),
    notificationKey,
    status: "pending",
    sessionId: context.sessionId,
    beatId: context.beatId,
    beatTitle: context.beatTitle,
    repoPath: context.repoPath,
    createdAt: now,
    updatedAt: now,
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

function buildApprovalNotificationKey(
  request: ApprovalRequest,
  context: ApprovalEscalationContext,
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
    request.message ?? "",
    request.question ?? "",
    request.toolParamsDisplay ?? "",
    request.parameterSummary ?? "",
    request.options.join("|"),
  ].join("\u0000");
}

function shortHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `approval-${(hash >>> 0).toString(16)}`;
}
