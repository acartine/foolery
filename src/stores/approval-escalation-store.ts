import { create } from "zustand";
import {
  logApprovalEscalation,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";

interface ApprovalEscalationState {
  approvals: ApprovalEscalation[];
  upsertPendingApproval: (approval: ApprovalEscalation) => boolean;
  markManualAction: (id: string) => void;
  dismissApproval: (id: string) => void;
  clearAll: () => void;
}

export const useApprovalEscalationStore =
  create<ApprovalEscalationState>((set) => ({
    approvals: [],
    upsertPendingApproval: (approval) => {
      let created = false;
      set((state) => {
        const existing = state.approvals.find(
          (item) => item.notificationKey === approval.notificationKey,
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
        return {
          approvals: [approval, ...state.approvals],
        };
      });
      return created;
    },
    markManualAction: (id) => {
      set((state) => ({
        approvals: state.approvals.map((approval) => {
          if (approval.id !== id) return approval;
          const next = {
            ...approval,
            status: "manual_required" as const,
            updatedAt: Date.now(),
          };
          logApprovalEscalation(
            "approval.manual_action_marked",
            approvalLogContext(next),
          );
          return next;
        }),
      }));
    },
    dismissApproval: (id) => {
      set((state) => ({
        approvals: state.approvals.map((approval) => {
          if (approval.id !== id) return approval;
          const next = {
            ...approval,
            status: "dismissed" as const,
            updatedAt: Date.now(),
          };
          logApprovalEscalation(
            "approval.dismissed",
            approvalLogContext(next),
          );
          return next;
        }),
      }));
    },
    clearAll: () => set({ approvals: [] }),
  }));

export function selectPendingApprovals(
  state: ApprovalEscalationState,
): ApprovalEscalation[] {
  return state.approvals.filter(
    (approval) => approval.status !== "dismissed",
  );
}

export function selectPendingApprovalCount(
  state: ApprovalEscalationState,
): number {
  return selectPendingApprovals(state).length;
}

function approvalLogContext(approval: ApprovalEscalation) {
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
    status: approval.status,
  };
}
