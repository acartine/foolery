/**
 * Canonical, session-independent registry for approval escalations.
 *
 * Records are shared references with the per-session
 * `SessionEntry.pendingApprovals` map: the registry holds the same
 * `PendingApprovalRecord` object that the entry holds. This keeps both
 * data structures in sync without an explicit copy step. When a terminal
 * session is removed, the registry detaches its responder but keeps the
 * record listed so direct API pollers can still see it.
 */

import {
  approvalEscalationFromPendingRecord,
  logApprovalEscalation,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import {
  isActiveApprovalStatus,
  type ApprovalAction,
  type ApprovalEscalationStatus,
  type ApprovalReplyResult,
  type PendingApprovalRecord,
} from "@/lib/approval-actions";
import type { ExecutionAgentInfo } from "@/lib/execution-port";

export type ApprovalResponder = (
  record: PendingApprovalRecord,
  action: ApprovalAction,
) => Promise<ApprovalReplyResult>;

export interface ApprovalRegistryEntry {
  record: PendingApprovalRecord;
  sessionId: string;
  responder: ApprovalResponder | null;
  agentInfo?: ExecutionAgentInfo;
}

export interface ApprovalListFilter {
  repoPath?: string;
  status?:
    | ApprovalEscalationStatus
    | readonly ApprovalEscalationStatus[];
  activeOnly?: boolean;
  updatedSince?: number;
}

export interface ApprovalAgent {
  provider?: string;
  name?: string;
  model?: string;
  version?: string;
}

export interface ApprovalEscalationDto extends ApprovalEscalation {
  actionable: boolean;
  actionableReason?: string;
  agent?: ApprovalAgent;
}

export interface ApprovalActionExecution {
  ok: boolean;
  httpStatus: number;
  record?: PendingApprovalRecord;
  error?: string;
  code?: string;
}

const g = globalThis as unknown as {
  __approvalRegistry?: Map<string, ApprovalRegistryEntry>;
};

export function getApprovalRegistry(): Map<
  string,
  ApprovalRegistryEntry
> {
  if (!g.__approvalRegistry) {
    g.__approvalRegistry = new Map();
  }
  return g.__approvalRegistry;
}

export function clearApprovalRegistry(): void {
  getApprovalRegistry().clear();
}

export function registerApproval(args: {
  sessionId: string;
  record: PendingApprovalRecord;
  responder: ApprovalResponder | null;
  agentInfo?: ExecutionAgentInfo;
}): void {
  const registry = getApprovalRegistry();
  const existing = registry.get(args.record.approvalId);
  if (existing) {
    existing.record = args.record;
    existing.sessionId = args.sessionId;
    if (args.responder) existing.responder = args.responder;
    if (args.agentInfo) existing.agentInfo = args.agentInfo;
    return;
  }
  registry.set(args.record.approvalId, {
    record: args.record,
    sessionId: args.sessionId,
    responder: args.responder,
    agentInfo: args.agentInfo,
  });
}

export function attachResponderForSession(
  sessionId: string,
  responder: ApprovalResponder,
  agentInfo?: ExecutionAgentInfo,
): void {
  for (const entry of getApprovalRegistry().values()) {
    if (entry.sessionId !== sessionId) continue;
    entry.responder = responder;
    if (agentInfo) entry.agentInfo = agentInfo;
  }
}

export function detachSession(
  sessionId: string,
  reason: string,
): void {
  for (const entry of getApprovalRegistry().values()) {
    if (entry.sessionId !== sessionId) continue;
    entry.responder = null;
    if (isActiveApprovalStatus(entry.record.status)) {
      entry.record.status = "manual_required";
      entry.record.updatedAt = Date.now();
      logApprovalEscalation("approval.session_detached", {
        approvalId: entry.record.approvalId,
        notificationKey: entry.record.notificationKey,
        sessionId: entry.sessionId,
        beatId: entry.record.beatId,
        repoPath: entry.record.repoPath,
        adapter: entry.record.adapter,
        source: entry.record.source,
        serverName: entry.record.serverName,
        toolName: entry.record.toolName,
        nativeSessionId: entry.record.nativeSessionId,
        requestId: entry.record.requestId,
        status: entry.record.status,
        reason,
      });
    }
  }
}

export function getApproval(
  approvalId: string,
): ApprovalRegistryEntry | undefined {
  return getApprovalRegistry().get(approvalId);
}

export function listApprovals(
  filter: ApprovalListFilter = {},
): ApprovalEscalationDto[] {
  const allEntries = Array.from(
    getApprovalRegistry().values(),
  );
  const filtered = allEntries.filter(
    (entry) => matchesFilter(entry, filter),
  );
  filtered.sort(compareEntries);
  return filtered.map(toDto);
}

function matchesFilter(
  entry: ApprovalRegistryEntry,
  filter: ApprovalListFilter,
): boolean {
  if (
    filter.repoPath &&
    entry.record.repoPath !== filter.repoPath
  ) {
    return false;
  }
  if (filter.activeOnly && !isActiveApprovalStatus(
    entry.record.status,
  )) {
    return false;
  }
  if (filter.status !== undefined) {
    const allowed = Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
    if (!allowed.includes(entry.record.status)) return false;
  }
  if (
    filter.updatedSince !== undefined &&
    entry.record.updatedAt < filter.updatedSince
  ) {
    return false;
  }
  return true;
}

function compareEntries(
  a: ApprovalRegistryEntry,
  b: ApprovalRegistryEntry,
): number {
  if (a.record.updatedAt !== b.record.updatedAt) {
    return b.record.updatedAt - a.record.updatedAt;
  }
  return a.record.approvalId.localeCompare(
    b.record.approvalId,
  );
}

function toDto(
  entry: ApprovalRegistryEntry,
): ApprovalEscalationDto {
  const escalation = approvalEscalationFromPendingRecord(
    entry.record,
  );
  const reason = unactionableReason(entry);
  return {
    ...escalation,
    actionable: reason === undefined,
    actionableReason: reason,
    agent: agentFromInfo(entry.agentInfo),
  };
}

function agentFromInfo(
  info: ExecutionAgentInfo | undefined,
): ApprovalAgent | undefined {
  if (!info) return undefined;
  const agent: ApprovalAgent = {};
  if (info.agentProvider) agent.provider = info.agentProvider;
  if (info.agentName) agent.name = info.agentName;
  if (info.agentModel) agent.model = info.agentModel;
  if (info.agentVersion) agent.version = info.agentVersion;
  return Object.keys(agent).length > 0 ? agent : undefined;
}

function unactionableReason(
  entry: ApprovalRegistryEntry,
): string | undefined {
  if (!isActiveApprovalStatus(entry.record.status)) {
    return "approval_status_terminal";
  }
  if (!entry.responder) return "approval_responder_unavailable";
  if (!entry.record.replyTarget) {
    return "approval_reply_target_missing";
  }
  if (entry.record.supportedActions.length === 0) {
    return "approval_action_not_supported";
  }
  return undefined;
}

export function approvalDtoFromEntry(
  entry: ApprovalRegistryEntry,
): ApprovalEscalationDto {
  return toDto(entry);
}
