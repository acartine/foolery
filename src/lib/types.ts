import type { MemoryManagerType } from "@/lib/memory-managers";

// ── Beat types ──────────────────────────────────────────────

/**
 * Open string type identifier.
 * Knots gives "work"; beads may give "task", "bug", "feature", etc.
 */
export type BeatType = string;

export type BeatPriority = 0 | 1 | 2 | 3 | 4;

export type WorkflowMode =
  | "granular_autonomous"
  | "coarse_human_gated";

export type ActionOwnerKind = "agent" | "human" | "none";

export interface MemoryWorkflowOwners {
  planning: ActionOwnerKind;
  plan_review: ActionOwnerKind;
  implementation: ActionOwnerKind;
  implementation_review: ActionOwnerKind;
  shipment: ActionOwnerKind;
  shipment_review: ActionOwnerKind;
}

export interface MemoryWorkflowDescriptor {
  id: string;
  backingWorkflowId: string;
  label: string;
  mode: WorkflowMode;
  initialState: string;
  states: string[];
  terminalStates: string[];
  transitions?: Array<{ from: string; to: string }>;
  finalCutState: string | null;
  retakeState: string;
  promptProfileId: string;
  profileId?: string;
  owners?: MemoryWorkflowOwners;
  queueStates?: string[];
  actionStates?: string[];
  reviewQueueStates?: string[];
  humanQueueStates?: string[];
}

/**
 * Beat — the core work-item model for Foolery.
 *
 * `type` is an open string (knots: "work", beads: "task"/"bug"/etc.).
 * `state` is the canonical workflow state (e.g. "ready_for_implementation",
 * "shipped"), replacing the old status/compatStatus/workflowState fields.
 */
export interface Beat {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  acceptance?: string;
  type: string;
  state: string;
  workflowId?: string;
  workflowMode?: WorkflowMode;
  profileId?: string;
  nextActionState?: string;
  nextActionOwnerKind?: ActionOwnerKind;
  requiresHumanAction?: boolean;
  isAgentClaimable?: boolean;
  priority: BeatPriority;
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

export interface BeatDependency {
  id: string;
  type?: string;
  source?: string;
  target?: string;
  dependency_type?: string;
  title?: string;
  description?: string;
  state?: string;
  priority?: BeatPriority;
  issue_type?: string;
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

export interface BeatWithRepo extends Beat {
  _repoPath: string;
  _repoName: string;
}

// ── Terminal types ──────────────────────────────────────────

export type TerminalSessionStatus = "idle" | "running" | "completed" | "error" | "aborted";

export interface TerminalSession {
  id: string;
  beatId: string;
  beatTitle: string;
  beatIds?: string[];
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

export interface WaveBeat {
  id: string;
  title: string;
  type: string;
  state: string;
  priority: BeatPriority;
  labels: string[];
  blockedBy: string[];
  readiness: WaveReadiness;
  readinessReason: string;
  waveLevel?: number;
}

export interface Wave {
  level: number;
  beats: WaveBeat[];
  gate?: WaveBeat;
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
  beatId: string;
  title: string;
  waveLevel: number;
  reason: string;
}

export interface WavePlan {
  waves: Wave[];
  unschedulable: WaveBeat[];
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

export interface OrchestrationWaveBeat {
  id: string;
  title: string;
}

export interface OrchestrationWave {
  waveIndex: number;
  name: string;
  objective: string;
  agents: OrchestrationAgentSpec[];
  beats: OrchestrationWaveBeat[];
  notes?: string;
}

export interface OrchestrationPlan {
  summary: string;
  waves: OrchestrationWave[];
  unassignedBeatIds: string[];
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

export interface BreakdownBeatSpec {
  title: string;
  type: string;
  priority: BeatPriority;
  description?: string;
}

export interface BreakdownWave {
  waveIndex: number;
  name: string;
  objective: string;
  beats: BreakdownBeatSpec[];
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
  parentBeatId: string;
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
  createdBeatIds: string[];
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

// ── OpenRouter types ──────────────────────────────────────

// Canonical OpenRouterModel lives in src/lib/openrouter.ts
export type { OpenRouterModel } from "./openrouter";

// ── Deprecated re-exports (to be removed in cleanup pass) ───

/** @deprecated Use Beat */
export type Bead = Beat;
/** @deprecated Use BeatType */
export type BeadType = BeatType;
/** @deprecated Use string for state */
export type BeadStatus = string;
/** @deprecated Use BeatPriority */
export type BeadPriority = BeatPriority;
/** @deprecated Use BeatDependency */
export type BeadDependency = BeatDependency;
/** @deprecated Use BeatWithRepo */
export type BeadWithRepo = BeatWithRepo;
/** @deprecated Use WaveBeat */
export type WaveBead = WaveBeat;
/** @deprecated Use BreakdownBeatSpec */
export type BreakdownBeadSpec = BreakdownBeatSpec;
/** @deprecated Use OrchestrationWaveBeat */
export type OrchestrationWaveBead = OrchestrationWaveBeat;
