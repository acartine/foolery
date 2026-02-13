import type { OrchestrationPlan, OrchestrationSession } from "@/lib/types";

export const ORCHESTRATION_RESTAGE_DRAFT_KEY =
  "foolery:orchestration:restage-draft";

export interface OrchestrationRestageDraft {
  repoPath: string;
  session: OrchestrationSession;
  plan: OrchestrationPlan;
  waveEdits: Record<string, { name: string; slug: string }>;
  objective?: string;
  statusText?: string;
}
