import type {
  OrchestrationAgentSpec,
  OrchestrationWaveBeat,
} from "@/lib/types";

export interface PlanStep {
  stepIndex: number;
  beatIds: string[];
  notes?: string;
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

export interface PlanDocument {
  repoPath: string;
  beatIds: string[];
  objective?: string;
  summary: string;
  waves: PlanWave[];
  unassignedBeatIds: string[];
  assumptions: string[];
  mode?: "scene" | "groom";
  model?: string;
}

export interface PlanArtifact {
  id: string;
  type: "execution_plan";
  state: string;
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanLineage {
  replacesPlanId?: string;
  replacedByPlanIds: string[];
}

export interface PlanBeatProgress {
  beatId: string;
  title?: string;
  state: string;
  satisfied: boolean;
}

export interface PlanStepProgress {
  waveIndex: number;
  stepIndex: number;
  beatIds: string[];
  notes?: string;
  complete: boolean;
  satisfiedBeatIds: string[];
  remainingBeatIds: string[];
}

export interface PlanWaveProgress {
  waveIndex: number;
  complete: boolean;
  steps: PlanStepProgress[];
}

export interface NextPlanStep {
  waveIndex: number;
  stepIndex: number;
  beatIds: string[];
  notes?: string;
}

export interface PlanProgress {
  generatedAt: string;
  completionRule: "shipped";
  beatStates: PlanBeatProgress[];
  satisfiedBeatIds: string[];
  remainingBeatIds: string[];
  nextStep: NextPlanStep | null;
  waves: PlanWaveProgress[];
}

export interface PlanRecord {
  artifact: PlanArtifact;
  plan: PlanDocument;
  progress: PlanProgress;
  lineage: PlanLineage;
  skillPrompt: string;
}

export interface PlanSummary {
  artifact: PlanArtifact;
  plan: Pick<
    PlanDocument,
    "repoPath" | "beatIds" | "objective" | "summary" | "mode" | "model"
  >;
}

export interface CreatePlanInput {
  repoPath: string;
  beatIds: string[];
  objective?: string;
  model?: string;
  mode?: "scene" | "groom";
  replacesPlanId?: string;
}
