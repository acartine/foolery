export type BeadType =
  | "bug"
  | "feature"
  | "task"
  | "epic"
  | "chore"
  | "merge-request"
  | "molecule"
  | "gate";

export type BeadStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "deferred"
  | "closed";

export type BeadPriority = 0 | 1 | 2 | 3 | 4;

export interface Bead {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  acceptance?: string;
  type: BeadType;
  status: BeadStatus;
  priority: BeadPriority;
  labels: string[];
  assignee?: string;
  owner?: string;
  parent?: string;
  due?: string;
  estimate?: number;
  created: string;
  updated: string;
  closed?: string;
  metadata?: Record<string, unknown>;
}

export interface BeadDependency {
  id: string;
  type?: string;
  source?: string;
  target?: string;
  dependency_type?: string;
  title?: string;
  description?: string;
  status?: BeadStatus;
  priority?: BeadPriority;
  issue_type?: BeadType;
  owner?: string;
}

export interface BdResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface RegisteredRepo {
  path: string;
  name: string;
  addedAt: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isBeadsRepo: boolean;
}

export interface BeadWithRepo extends Bead {
  _repoPath: string;
  _repoName: string;
}

// ── Terminal types ──────────────────────────────────────────

export type TerminalSessionStatus = "idle" | "running" | "completed" | "error" | "aborted";

export interface TerminalSession {
  id: string;
  beadId: string;
  beadTitle: string;
  status: TerminalSessionStatus;
  startedAt: string;
  exitCode?: number;
}

export interface TerminalEvent {
  type: "stdout" | "stderr" | "exit";
  data: string;
  timestamp: number;
}

// ── Wave planner types ──────────────────────────────────────

export interface WaveBead {
  id: string;
  title: string;
  type: BeadType;
  status: BeadStatus;
  priority: BeadPriority;
  labels: string[];
  blockedBy: string[];
  readiness: WaveReadiness;
  readinessReason: string;
  waveLevel?: number;
}

export interface Wave {
  level: number;
  beads: WaveBead[];
  gate?: WaveBead;
}

export type WaveReadiness =
  | "runnable"
  | "in_progress"
  | "blocked"
  | "verification"
  | "gate"
  | "unschedulable";

export interface WaveSummary {
  total: number;
  runnable: number;
  inProgress: number;
  blocked: number;
  verification: number;
  gates: number;
  unschedulable: number;
}

export interface WaveRecommendation {
  beadId: string;
  title: string;
  waveLevel: number;
  reason: string;
}

export interface WavePlan {
  waves: Wave[];
  unschedulable: WaveBead[];
  summary: WaveSummary;
  recommendation?: WaveRecommendation;
  runnableQueue: WaveRecommendation[];
  computedAt: string;
}

// ── Claude orchestration types ─────────────────────────────

export interface OrchestrationAgentSpec {
  role: string;
  count: number;
  specialty?: string;
}

export interface OrchestrationWaveBead {
  id: string;
  title: string;
}

export interface OrchestrationWave {
  waveIndex: number;
  name: string;
  objective: string;
  agents: OrchestrationAgentSpec[];
  beads: OrchestrationWaveBead[];
  notes?: string;
}

export interface OrchestrationPlan {
  summary: string;
  waves: OrchestrationWave[];
  unassignedBeadIds: string[];
  assumptions: string[];
}

export type OrchestrationSessionStatus =
  | "running"
  | "completed"
  | "error"
  | "aborted";

export interface OrchestrationSession {
  id: string;
  repoPath: string;
  status: OrchestrationSessionStatus;
  startedAt: string;
  objective?: string;
  completedAt?: string;
  error?: string;
  plan?: OrchestrationPlan;
}

export type OrchestrationEventType =
  | "log"
  | "plan"
  | "status"
  | "error"
  | "exit";

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  data: string | OrchestrationPlan;
  timestamp: number;
}

export interface AppliedWaveResult {
  waveIndex: number;
  waveId: string;
  waveTitle: string;
  childCount: number;
}

export interface ApplyOrchestrationResult {
  applied: AppliedWaveResult[];
  skipped: string[];
}
