import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  logApprovalEscalation,
  mergeApprovalReplyTarget,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import {
  approvalStatusForAction,
  isActiveApprovalStatus,
  isTerminalApprovalStatus,
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

export const APPROVAL_ESCALATION_STORE_NAME =
  "foolery-approval-escalations";

export const useApprovalEscalationStore =
  create<ApprovalEscalationState>()(
    persist(
      (set) => ({
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
      }),
      {
        name: APPROVAL_ESCALATION_STORE_NAME,
        storage: createJSONStorage(() =>
          typeof window !== "undefined"
            ? window.localStorage
            : memoryStorage(),
        ),
        version: 1,
        partialize: (state) => ({
          approvals: state.approvals.filter((approval) =>
            isActiveApprovalStatus(approval.status)),
        }),
      },
    ),
  );

export function selectPendingApprovals(
  state: Pick<ApprovalEscalationState, "approvals">,
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
      const matchKey = approval.logicalKey
        ?? approval.notificationKey;
      const existing = state.approvals.find(
        (item) => (item.logicalKey ?? item.notificationKey)
          === matchKey,
      );
      if (existing) {
        logApprovalEscalation(
          "approval.duplicate_suppressed",
          approvalLogContext(existing),
        );
        return {
          approvals: state.approvals.map((item) => {
            if (
              (item.logicalKey ?? item.notificationKey)
                !== matchKey
            ) return item;
            if (isTerminalApprovalStatus(item.status)) {
              return { ...item, updatedAt: approval.updatedAt };
            }
            return {
              ...item,
              updatedAt: approval.updatedAt,
              requestId: approval.requestId ?? item.requestId,
              permissionId:
                approval.permissionId ?? item.permissionId,
              replyTarget: mergeApprovalReplyTarget(
                item.replyTarget,
                approval.replyTarget,
              ),
              supportedActions:
                approval.supportedActions
                ?? item.supportedActions,
              parameterSummary:
                approval.parameterSummary
                ?? item.parameterSummary,
              toolParamsDisplay:
                approval.toolParamsDisplay
                ?? item.toolParamsDisplay,
              patterns:
                approval.patterns?.length
                  ? approval.patterns
                  : item.patterns,
              agentName: approval.agentName ?? item.agentName,
              agentModel:
                approval.agentModel ?? item.agentModel,
              agentVersion:
                approval.agentVersion ?? item.agentVersion,
              agentCommand:
                approval.agentCommand ?? item.agentCommand,
            };
          }),
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

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
