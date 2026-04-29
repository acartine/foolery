import type { ApprovalEscalation } from "@/lib/approval-escalations";

export interface ScopedApproval extends ApprovalEscalation {
  isCrossRepo: boolean;
}

export function annotateApprovalsForRepo(
  approvals: ApprovalEscalation[],
  activeRepo: string | null | undefined,
): ScopedApproval[] {
  const scoped = approvals.map<ScopedApproval>((approval) => ({
    ...approval,
    isCrossRepo: Boolean(
      activeRepo
      && approval.repoPath
      && approval.repoPath !== activeRepo,
    ),
  }));
  return scoped.sort((a, b) => {
    if (a.isCrossRepo === b.isCrossRepo) {
      return b.createdAt - a.createdAt;
    }
    return a.isCrossRepo ? 1 : -1;
  });
}

export function selectActiveRepoApprovals(
  approvals: ApprovalEscalation[],
  activeRepo: string | null | undefined,
): ApprovalEscalation[] {
  if (!activeRepo) return approvals;
  return approvals.filter(
    (approval) =>
      !approval.repoPath || approval.repoPath === activeRepo,
  );
}
