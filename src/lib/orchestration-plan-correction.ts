import { getBackend } from "@/lib/backend-instance";
import { getPlan } from "@/lib/orchestration-plan-manager";
import type { PlanRecord } from "@/lib/orchestration-plan-types";
import { isTerminalPlanArtifactState } from "@/lib/setlist-chart";

export async function completePlan(
  planId: string,
  repoPath: string,
): Promise<PlanRecord> {
  const existing = await getPlan(planId, repoPath);
  if (!existing) {
    throw new Error(`Plan ${planId} not found`);
  }
  if (isTerminalPlanArtifactState(existing.artifact.state)) {
    throw new Error(
      `Plan ${planId} is already complete (state=${existing.artifact.state}).`,
    );
  }
  const closed = await getBackend().close(
    planId,
    "user_complete_plan",
    repoPath,
  );
  if (!closed.ok) {
    throw new Error(
      closed.error?.message ?? `Failed to complete plan ${planId}.`,
    );
  }
  const updated = await getPlan(planId, repoPath);
  if (!updated) {
    throw new Error(
      `Plan ${planId} disappeared after completion.`,
    );
  }
  return updated;
}
