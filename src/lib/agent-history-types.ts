export type AgentHistoryInteractionType = "take" | "scene" | "verification" | "direct" | "breakdown";

export interface AgentHistoryEntry {
  id: string;
  kind: "session_start" | "prompt" | "response" | "session_end";
  ts: string;
  prompt?: string;
  promptSource?: string;
  raw?: string;
  status?: string;
  exitCode?: number | null;
}

export interface AgentHistorySession {
  sessionId: string;
  interactionType: AgentHistoryInteractionType;
  repoPath: string;
  beadIds: string[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  status?: string;
  exitCode?: number | null;
  entries: AgentHistoryEntry[];
  agentName?: string;
  agentModel?: string;
}

export interface AgentHistoryBeatSummary {
  beadId: string;
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
  selectedBeadId?: string;
  selectedRepoPath?: string;
}
