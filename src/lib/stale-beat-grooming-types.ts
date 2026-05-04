import type { Beat } from "@/lib/types";

export const STALE_BEAT_AGE_DAYS = 7;

export const STALE_GROOMING_DECISIONS = [
  "still_do",
  "reshape",
  "drop",
] as const;

export type StaleGroomingDecision =
  (typeof STALE_GROOMING_DECISIONS)[number];

export const STALE_GROOMING_DECISION_LABELS: Record<
  StaleGroomingDecision,
  string
> = {
  still_do: "Still do",
  reshape: "Reshape",
  drop: "Drop",
};

export interface StaleBeatSummary {
  key: string;
  beatId: string;
  title: string;
  state: string;
  ageDays: number;
  createdAgeDays: number | null;
  created: string;
  updated: string;
  repoPath?: string;
  repoName?: string;
  beat: Beat;
}

export interface StaleBeatReviewTarget {
  beatId: string;
  repoPath?: string;
}

export interface StaleBeatReviewRequest {
  agentId?: string;
  targets: StaleBeatReviewTarget[];
}

export interface StaleBeatGroomingAgentOption {
  id: string;
  label: string;
  command: string;
  model?: string;
  vendor?: string;
  provider?: string;
}

export interface StaleBeatGroomingOptions {
  agents: StaleBeatGroomingAgentOption[];
  defaultAgentId?: string;
  defaultError?: string;
}

export type StaleBeatReviewStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface StaleBeatGroomingResult {
  decision: StaleGroomingDecision;
  rationale: string;
  suggestedTitle?: string;
  suggestedDescription?: string;
  suggestedAcceptance?: string;
}

export interface StaleBeatGroomingReviewRecord {
  key: string;
  jobId: string;
  beatId: string;
  status: StaleBeatReviewStatus;
  queuedAt: number;
  agentId: string;
  repoPath?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: StaleBeatGroomingResult;
}

export interface EnqueueStaleBeatGroomingResponse {
  jobs: Array<{
    jobId: string;
    beatId: string;
    repoPath?: string;
  }>;
  agentId: string;
}

export interface StaleBeatGroomingActiveJob {
  jobId: string;
  beatId: string;
  agentId: string;
  startedAt: number;
  repoPath?: string;
}

export interface StaleBeatGroomingFailure {
  jobId: string;
  beatId: string;
  reason: string;
  timestamp: number;
  repoPath?: string;
}

export interface StaleBeatGroomingCompletion {
  jobId: string;
  beatId: string;
  timestamp: number;
  decision?: StaleGroomingDecision;
  repoPath?: string;
}

export interface StaleBeatGroomingWorkerHealth {
  workerCount: number;
  activeJobs: StaleBeatGroomingActiveJob[];
  totalCompleted: number;
  totalFailed: number;
  recentFailures: StaleBeatGroomingFailure[];
  recentCompletions: StaleBeatGroomingCompletion[];
  uptimeMs: number | null;
}

export interface StaleBeatGroomingStatus {
  queueSize: number;
  reviews: StaleBeatGroomingReviewRecord[];
  worker: StaleBeatGroomingWorkerHealth;
}
