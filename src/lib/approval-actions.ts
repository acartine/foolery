export const APPROVAL_ACTIONS = [
  "approve",
  "always_approve",
  "reject",
] as const;

export type ApprovalAction =
  typeof APPROVAL_ACTIONS[number];

export type ApprovalEscalationStatus =
  | "pending"
  | "responding"
  | "approved"
  | "always_approved"
  | "rejected"
  | "manual_required"
  | "dismissed"
  | "reply_failed"
  | "unsupported";

export type ApprovalReplyTransport =
  | "http"
  | "jsonrpc"
  | "acp"
  | "stdio";

export interface ApprovalReplyTarget {
  adapter: string;
  transport: ApprovalReplyTransport;
  nativeSessionId?: string;
  requestId?: string;
  permissionId?: string;
}

export interface ApprovalReplyResult {
  ok: boolean;
  status?: ApprovalEscalationStatus;
  reason?: string;
  message?: string;
}

export interface PendingApprovalRecord {
  approvalId: string;
  notificationKey: string;
  terminalSessionId: string;
  beatId?: string;
  beatTitle?: string;
  repoPath?: string;
  adapter: string;
  source: string;
  message?: string;
  question?: string;
  serverName?: string;
  toolName?: string;
  toolParamsDisplay?: string;
  parameterSummary?: string;
  toolUseId?: string;
  nativeSessionId?: string;
  requestId?: string;
  permissionId?: string;
  permissionName?: string;
  patterns: string[];
  options: string[];
  replyTarget?: ApprovalReplyTarget;
  supportedActions: ApprovalAction[];
  status: ApprovalEscalationStatus;
  failureReason?: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  agentCommand?: string;
  createdAt: number;
  updatedAt: number;
}

export function isApprovalAction(
  value: unknown,
): value is ApprovalAction {
  return typeof value === "string" &&
    APPROVAL_ACTIONS.includes(value as ApprovalAction);
}

export function normalizeSupportedActions(
  actions: readonly ApprovalAction[] | undefined,
): ApprovalAction[] {
  if (!actions) return [];
  return APPROVAL_ACTIONS.filter((action) =>
    actions.includes(action));
}

export function approvalStatusForAction(
  action: ApprovalAction,
): ApprovalEscalationStatus {
  switch (action) {
    case "approve":
      return "approved";
    case "always_approve":
      return "always_approved";
    case "reject":
      return "rejected";
  }
}

export function isTerminalApprovalStatus(
  status: ApprovalEscalationStatus,
): boolean {
  return status === "approved" ||
    status === "always_approved" ||
    status === "rejected" ||
    status === "dismissed";
}

export function isActiveApprovalStatus(
  status: ApprovalEscalationStatus,
): boolean {
  return !isTerminalApprovalStatus(status);
}

export function approvalActionLabel(
  action: ApprovalAction,
): string {
  switch (action) {
    case "approve":
      return "Approve";
    case "always_approve":
      return "Always approve";
    case "reject":
      return "Reject";
  }
}
