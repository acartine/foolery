import {
  approvalEscalationFromPendingRecord,
} from "@/lib/approval-escalations";
import {
  isActiveApprovalStatus,
} from "@/lib/approval-actions";
import {
  enqueueApprovalEscalation,
} from "@/lib/approval-escalation-client";
import {
  fetchApprovalEscalations,
} from "@/lib/approval-escalation-api";
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

export async function hydrateApprovalEscalationsFromApi(): Promise<void> {
  const items = await fetchApprovalEscalations({ active: true });
  for (const item of items) {
    if (!isActiveApprovalStatus(item.status)) continue;
    enqueueApprovalEscalation(item, "approval.hydrated");
  }
}
