import type { MemoryManagerType } from "@/lib/memory-managers";

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

export type WorkflowMode =
  | "granular_autonomous"
  | "coarse_human_gated";

export type CoarsePrPreference =
  | "soft_required"
  | "preferred"
  | "none";

export interface MemoryWorkflowDescriptor {
  id: string;
  backingWorkflowId: string;
  label: string;
  mode: WorkflowMode;
  initialState: string;
  states: string[];
  terminalStates: string[];
  finalCutState: string | null;
  retakeState: string;
  promptProfileId: string;
  coarsePrPreferenceDefault?: CoarsePrPreference;
}

export type BeadPriority = 0 | 1 | 2 | 3 | 4;

export interface Bead {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  acceptance?: string;
  type: BeadType;
  status: BeadStatus;
  compatStatus?: BeadStatus;
  workflowId?: string;
  workflowMode?: WorkflowMode;
  workflowState?: string;
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
  memoryManagerType?: MemoryManagerType;
}

export interface DirEntry {
  name: string;
  path: string;
  memoryManagerType?: MemoryManagerType;
  isCompatible: boolean;
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
  beadIds?: string[];
  repoPath?: string;
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

export interface AppliedWaveChild {
  id: string;
  title: string;
}

export interface AppliedWaveResult {
  waveIndex: number;
  waveId: string;
  waveSlug: string;
  waveTitle: string;
  childCount: number;
  children: AppliedWaveChild[];
}

export interface ApplyOrchestrationResult {
  applied: AppliedWaveResult[];
  skipped: string[];
}

export interface ApplyOrchestrationOverrides {
  waveNames?: Record<string, string>;
  waveSlugs?: Record<string, string>;
}

// ── Breakdown types ──────────────────────────────────────

export interface BreakdownBeadSpec {
  title: string;
  type: BeadType;
  priority: BeadPriority;
  description?: string;
}

export interface BreakdownWave {
  waveIndex: number;
  name: string;
  objective: string;
  beads: BreakdownBeadSpec[];
  notes?: string;
}

export interface BreakdownPlan {
  summary: string;
  waves: BreakdownWave[];
  assumptions: string[];
}

export type BreakdownSessionStatus =
  | "running"
  | "completed"
  | "error"
  | "aborted";

export interface BreakdownSession {
  id: string;
  repoPath: string;
  parentBeadId: string;
  status: BreakdownSessionStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  plan?: BreakdownPlan;
}

export type BreakdownEventType =
  | "log"
  | "plan"
  | "status"
  | "error"
  | "exit";

export interface BreakdownEvent {
  type: BreakdownEventType;
  data: string | BreakdownPlan;
  timestamp: number;
}

export interface ApplyBreakdownResult {
  createdBeadIds: string[];
  waveCount: number;
}

// ── Agent management types ──────────────────────────────────

export interface RegisteredAgent {
  command: string;
  model?: string;
  label?: string;
}

export type ActionName =
  | "take"
  | "scene"
  | "direct"
  | "breakdown";

export interface ScannedAgent {
  id: string;
  command: string;
  path: string;
  installed: boolean;
}
