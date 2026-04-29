import { create } from "zustand";
import {
  logApprovalEscalation,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import {
  approvalStatusForAction,
  isActiveApprovalStatus,
  type ApprovalAction,
  type ApprovalEscalationStatus,
} from "@/lib/approval-actions";

interface ApprovalEscalationState {
  approvals: ApprovalEscalation[];
  upsertPendingApproval: (approval: ApprovalEscalation) => boolean;
  markApprovalResponding: (
    id: string,
    action: ApprovalAction,
  ) => void;
  markApprovalResolved: (
    id: string,
    action: ApprovalAction,
    status?: ApprovalEscalationStatus,
  ) => void;
  markApprovalUnsupported: (
    id: string,
    reason?: string,
  ) => void;
  markApprovalFailed: (
    id: string,
    reason?: string,
  ) => void;
  markManualAction: (id: string) => void;
  dismissApproval: (id: string) => void;
  clearAll: () => void;
}

type ApprovalEscalationSet = (
  updater:
    | Partial<ApprovalEscalationState>
    | ((
      state: ApprovalEscalationState,
    ) => Partial<ApprovalEscalationState>),
) => void;

export const useApprovalEscalationStore =
  create<ApprovalEscalationState>((set) => ({
    approvals: [],
    upsertPendingApproval:
      createUpsertPendingApproval(set),
    markApprovalResponding: (id, action) => {
      updateApprovalStatus(
        set,
        id,
        "responding",
        "approval.action_requested",
        action,
      );
    },
    markApprovalResolved: (id, action, status) => {
      updateApprovalStatus(
        set,
        id,
        status ?? approvalStatusForAction(action),
        "approval.action_resolved",
        action,
      );
    },
    markApprovalUnsupported: (id, reason) => {
      updateApprovalStatus(
        set,
        id,
        "unsupported",
        "approval.action_unsupported",
        undefined,
        reason,
      );
    },
    markApprovalFailed: (id, reason) => {
      updateApprovalStatus(
        set,
        id,
        "reply_failed",
        "approval.reply_failed",
        undefined,
        reason,
      );
    },
    markManualAction: (id) => {
      updateApprovalStatus(
        set,
        id,
        "manual_required",
        "approval.manual_action_marked",
      );
    },
    dismissApproval: (id) => {
      updateApprovalStatus(
        set,
        id,
        "dismissed",
        "approval.dismissed",
      );
    },
    clearAll: () => set({ approvals: [] }),
  }));

export function selectPendingApprovals(
  state: ApprovalEscalationState,
): ApprovalEscalation[] {
  return state.approvals.filter(
    (approval) => isActiveApprovalStatus(approval.status),
  );
}

export function selectPendingApprovalCount(
  state: ApprovalEscalationState,
): number {
  return selectPendingApprovals(state).length;
}

function createUpsertPendingApproval(
  set: ApprovalEscalationSet,
) {
  return (approval: ApprovalEscalation): boolean => {
    let created = false;
    set((state) => {
      const existing = state.approvals.find(
        (item) =>
          item.notificationKey === approval.notificationKey,
      );
      if (existing) {
        logApprovalEscalation(
          "approval.duplicate_suppressed",
          approvalLogContext(existing),
        );
        return {
          approvals: state.approvals.map((item) =>
            item.notificationKey === approval.notificationKey
              ? { ...item, updatedAt: approval.updatedAt }
              : item,
          ),
        };
      }
      created = true;
      logApprovalEscalation(
        "approval.pending_stored",
        approvalLogContext(approval),
      );
      return { approvals: [approval, ...state.approvals] };
    });
    return created;
  };
}

function updateApprovalStatus(
  set: ApprovalEscalationSet,
  id: string,
  status: ApprovalEscalationStatus,
  eventName: string,
  action?: ApprovalAction,
  reason?: string,
): void {
  set((state) => ({
    approvals: state.approvals.map((approval) => {
      if (approval.id !== id) return approval;
      const next = {
        ...approval,
        status,
        updatedAt: Date.now(),
      };
      logApprovalEscalation(
        eventName,
        approvalLogContext(next, action, reason),
      );
      return next;
    }),
  }));
}

function approvalLogContext(
  approval: ApprovalEscalation,
  action?: ApprovalAction,
  reason?: string,
) {
  return {
    approvalId: approval.id,
    notificationKey: approval.notificationKey,
    sessionId: approval.sessionId,
    beatId: approval.beatId,
    repoPath: approval.repoPath,
    adapter: approval.adapter,
    source: approval.source,
    serverName: approval.serverName,
    toolName: approval.toolName,
    nativeSessionId: approval.nativeSessionId,
    requestId: approval.requestId,
    status: approval.status,
    action,
    reason,
  };
}
