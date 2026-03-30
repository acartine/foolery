export type AgentHistoryInteractionType = "take" | "scene" | "direct" | "breakdown";

export interface AgentHistoryEntry {
  id: string;
  kind: "session_start" | "prompt" | "response" | "session_end";
  ts: string;
  prompt?: string;
  promptSource?: string;
  promptNumber?: number;
  workflowState?: string;
  raw?: string;
  status?: string;
  exitCode?: number | null;
}

export interface AgentHistorySession {
  sessionId: string;
  interactionType: AgentHistoryInteractionType;
  repoPath: string;
  beatIds: string[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  status?: string;
  exitCode?: number | null;
  entries: AgentHistoryEntry[];
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
  workflowStates?: string[];
}

export interface AgentHistoryBeatTokenUsage {
  agentLabel: string;
  agentModel?: string;
  agentVersion?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentHistoryBeatSummary {
  beatId: string;
  repoPath: string;
  title?: string;
  lastWorkedAt: string;
  sessionCount: number;
  takeCount: number;
  sceneCount: number;
  directCount: number;
  breakdownCount: number;
  tokenUsageByAgent: AgentHistoryBeatTokenUsage[];
}

export interface AgentHistoryPayload {
  beats: AgentHistoryBeatSummary[];
  sessions: AgentHistorySession[];
  selectedBeatId?: string;
  selectedRepoPath?: string;
}
