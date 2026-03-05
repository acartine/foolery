export type AgentHistoryInteractionType = "take" | "scene" | "verification" | "direct" | "breakdown";

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
  workflowStates?: string[];
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
}

export interface AgentHistoryPayload {
  beats: AgentHistoryBeatSummary[];
  sessions: AgentHistorySession[];
  selectedBeatId?: string;
  selectedRepoPath?: string;
}
