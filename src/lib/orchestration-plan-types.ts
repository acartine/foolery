import type {
  OrchestrationAgentSpec,
  OrchestrationWaveBeat,
} from "@/lib/types";

export type PlanStatus =
  | "draft"
  | "active"
  | "complete"
  | "aborted";

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed";

export interface PlanStep {
  id: string;
  title: string;
  waveIndex: number;
  stepIndex: number;
  beatIds: string[];
  status: PlanStepStatus;
  dependsOn: string[];
  notes?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  failureReason?: string;
}

export interface PlanWave {
  waveIndex: number;
  name: string;
  objective: string;
  agents: OrchestrationAgentSpec[];
  beats: OrchestrationWaveBeat[];
  steps: PlanStep[];
  notes?: string;
}

export interface Plan {
  id: string;
  repoPath: string;
  objective?: string;
  createdAt: string;
  updatedAt: string;
  status: PlanStatus;
  summary: string;
  waves: PlanWave[];
  unassignedBeatIds: string[];
  assumptions: string[];
  mode?: "scene" | "groom";
  model?: string;
}

export interface CreatePlanInput {
  repoPath: string;
  objective?: string;
  model?: string;
  mode?: "scene" | "groom";
}
