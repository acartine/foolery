import {
  approvalEscalationFromPendingRecord,
} from "@/lib/approval-escalations";
import {
  isActiveApprovalStatus,
} from "@/lib/approval-actions";
import {
  enqueueApprovalEscalation,
} from "@/lib/approval-escalation-client";
import type { TerminalSession } from "@/lib/types";

export function hydrateApprovalEscalationsFromSessions(
  sessions: TerminalSession[],
): void {
  for (const session of sessions) {
    for (const record of session.pendingApprovals ?? []) {
      if (!isActiveApprovalStatus(record.status)) continue;
      enqueueApprovalEscalation(
        approvalEscalationFromPendingRecord(record),
        "approval.hydrated",
      );
    }
  }
}
