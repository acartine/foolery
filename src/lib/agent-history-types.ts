export type AgentHistoryInteractionType = "take" | "scene";

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
}

export interface AgentHistoryBeatSummary {
  beadId: string;
  repoPath: string;
  title?: string;
  lastWorkedAt: string;
  sessionCount: number;
  takeCount: number;
  sceneCount: number;
}

export interface AgentHistoryPayload {
  beats: AgentHistoryBeatSummary[];
  sessions: AgentHistorySession[];
  selectedBeadId?: string;
  selectedRepoPath?: string;
}
