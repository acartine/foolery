import { useNotificationStore } from "@/stores/notification-store";
import { useApprovalEscalationStore } from "@/stores/approval-escalation-store";
import {
  buildApprovalsHref,
  formatApprovalDetailText,
  formatApprovalPrimaryText,
  logApprovalEscalation,
  type ApprovalEscalation,
} from "@/lib/approval-escalations";
import { toast } from "sonner";

export function enqueueApprovalEscalation(
  approval: ApprovalEscalation,
  eventName = "approval.detected",
): boolean {
  logApprovalEscalation(eventName, approvalLogContext(approval));
  const created = useApprovalEscalationStore
    .getState()
    .upsertPendingApproval(approval);
  if (!created) return false;
  fireApprovalNotification(approval);
  return true;
}

function fireApprovalNotification(
  approval: ApprovalEscalation,
): void {
  const href = buildApprovalsHref(approval.repoPath);
  const detail = formatApprovalDetailText(approval);
  useNotificationStore.getState().addNotification({
    kind: "approval",
    message:
      `Approval required: ${formatApprovalPrimaryText(approval)}`,
    beatId: approval.beatId,
    repoPath: approval.repoPath,
    href,
    dedupeKey: approval.notificationKey,
  });
  toast.warning("Approval required", {
    description: detail,
    action: {
      label: "Open approvals",
      onClick: () => {
        window.location.href = href;
      },
    },
  });
  logApprovalEscalation(
    "approval.notification_emitted",
    approvalLogContext(approval),
  );
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
    nativeSessionId: approval.nativeSessionId,
    requestId: approval.requestId,
    status: approval.status,
  };
}
