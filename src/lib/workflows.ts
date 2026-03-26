import type {
  ActionOwnerKind,
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
  WorkflowMode,
} from "@/lib/types";

export const WF_STATE_LABEL_PREFIX = "wf:state:";
export const WF_PROFILE_LABEL_PREFIX = "wf:profile:";

export const DEFAULT_PROFILE_ID = "autopilot";
export const LEGACY_BEADS_COARSE_WORKFLOW_ID = "beads-coarse";
export const DEFAULT_WORKFLOW_ID = DEFAULT_PROFILE_ID;
export const DEFAULT_PROMPT_PROFILE_ID = DEFAULT_PROFILE_ID;

export const KNOTS_GRANULAR_DESCRIPTOR_ID = "autopilot";
export const KNOTS_COARSE_DESCRIPTOR_ID = "semiauto";
export const KNOTS_GRANULAR_PROMPT_PROFILE_ID = "autopilot";
export const KNOTS_COARSE_PROMPT_PROFILE_ID = "semiauto";

// ── Step abstraction ────────────────────────────────────────────

export const WorkflowStep = {
  Planning: "planning",
  PlanReview: "plan_review",
  Implementation: "implementation",
  ImplementationReview: "implementation_review",
  Shipment: "shipment",
  ShipmentReview: "shipment_review",
} as const;

export type WorkflowStep = (typeof WorkflowStep)[keyof typeof WorkflowStep];

export const StepPhase = {
  Queued: "queued",
  Active: "active",
} as const;

export type StepPhase = (typeof StepPhase)[keyof typeof StepPhase];

export interface ResolvedStep {
  step: WorkflowStep;
  phase: StepPhase;
}

const RESOLVED_STEP_MAP: ReadonlyMap<string, ResolvedStep> = new Map<string, ResolvedStep>([
  ["ready_for_planning", { step: WorkflowStep.Planning, phase: StepPhase.Queued }],
  ["planning", { step: WorkflowStep.Planning, phase: StepPhase.Active }],
  ["ready_for_plan_review", { step: WorkflowStep.PlanReview, phase: StepPhase.Queued }],
  ["plan_review", { step: WorkflowStep.PlanReview, phase: StepPhase.Active }],
  ["ready_for_implementation", { step: WorkflowStep.Implementation, phase: StepPhase.Queued }],
  ["implementation", { step: WorkflowStep.Implementation, phase: StepPhase.Active }],
  ["ready_for_implementation_review", { step: WorkflowStep.ImplementationReview, phase: StepPhase.Queued }],
  ["implementation_review", { step: WorkflowStep.ImplementationReview, phase: StepPhase.Active }],
  ["ready_for_shipment", { step: WorkflowStep.Shipment, phase: StepPhase.Queued }],
  ["shipment", { step: WorkflowStep.Shipment, phase: StepPhase.Active }],
  ["ready_for_shipment_review", { step: WorkflowStep.ShipmentReview, phase: StepPhase.Queued }],
  ["shipment_review", { step: WorkflowStep.ShipmentReview, phase: StepPhase.Active }],
]);

/** Map any raw workflow state string to its step + phase, or null for terminal/deferred/unknown. */
export function resolveStep(state: string): ResolvedStep | null {
  return RESOLVED_STEP_MAP.get(state) ?? null;
}

/** Returns the queue (ready_for_*) state for a given workflow step. */
export function queueStateForStep(step: WorkflowStep): string {
  switch (step) {
    case WorkflowStep.Planning: return "ready_for_planning";
    case WorkflowStep.PlanReview: return "ready_for_plan_review";
    case WorkflowStep.Implementation: return "ready_for_implementation";
    case WorkflowStep.ImplementationReview: return "ready_for_implementation_review";
    case WorkflowStep.Shipment: return "ready_for_shipment";
    case WorkflowStep.ShipmentReview: return "ready_for_shipment_review";
  }
}

// ── Step ordering ──────────────────────────────────────────────

/** Ordered workflow steps used for next/prior queue state derivation. */
const STEP_ORDER: readonly WorkflowStep[] = [
  WorkflowStep.Planning,
  WorkflowStep.PlanReview,
  WorkflowStep.Implementation,
  WorkflowStep.ImplementationReview,
  WorkflowStep.Shipment,
  WorkflowStep.ShipmentReview,
];

/**
 * Returns the queue state for the step that follows the given step,
 * or null if the given step is the last step (shipment_review).
 */
export function nextQueueStateForStep(step: WorkflowStep): string | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx < 0 || idx >= STEP_ORDER.length - 1) return null;
  return queueStateForStep(STEP_ORDER[idx + 1]!);
}

/**
 * Returns the queue state for the step that precedes the given step,
 * or null if the given step is the first step (planning).
 */
export function priorQueueStateForStep(step: WorkflowStep): string | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx <= 0) return null;
  return queueStateForStep(STEP_ORDER[idx - 1]!);
}

// ── Review-step helpers ────────────────────────────────────────

/** Maps each review step to the action step it reviews. */
const REVIEW_TO_ACTION_STEP: ReadonlyMap<WorkflowStep, WorkflowStep> = new Map([
  [WorkflowStep.PlanReview, WorkflowStep.Planning],
  [WorkflowStep.ImplementationReview, WorkflowStep.Implementation],
  [WorkflowStep.ShipmentReview, WorkflowStep.Shipment],
]);

/**
 * Returns true if the given step is a review step
 * (plan_review, implementation_review, shipment_review).
 */
export function isReviewStep(step: WorkflowStep): boolean {
  return REVIEW_TO_ACTION_STEP.has(step);
}

/** Returns the action step that precedes a review step, or null for non-review steps. */
export function priorActionStep(step: WorkflowStep): WorkflowStep | null {
  return REVIEW_TO_ACTION_STEP.get(step) ?? null;
}

interface BuiltinProfileConfig {
  id: string;
  displayName: string;
  description: string;
  planningMode: "required" | "skipped";
  implementationReviewMode: "required" | "skipped";
  output: "remote_main" | "pr";
  owners: MemoryWorkflowOwners;
}

const AGENT_OWNERS: MemoryWorkflowOwners = {
  planning: "agent",
  plan_review: "agent",
  implementation: "agent",
  implementation_review: "agent",
  shipment: "agent",
  shipment_review: "agent",
};

const SEMIAUTO_OWNERS: MemoryWorkflowOwners = {
  planning: "agent",
  plan_review: "human",
  implementation: "agent",
  implementation_review: "human",
  shipment: "agent",
  shipment_review: "agent",
};

const BUILTIN_PROFILE_CATALOG: ReadonlyArray<BuiltinProfileConfig> = [
  {
    id: "autopilot",
    displayName: "Autopilot",
    description: "Agent-owned full flow with remote main output",
    planningMode: "required",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: AGENT_OWNERS,
  },
  {
    id: "autopilot_with_pr",
    displayName: "Autopilot (PR)",
    description: "Agent-owned full flow with PR output",
    planningMode: "required",
    implementationReviewMode: "required",
    output: "pr",
    owners: AGENT_OWNERS,
  },
  {
    id: "semiauto",
    displayName: "Semiauto",
    description: "Human-gated plan and implementation reviews",
    planningMode: "required",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: SEMIAUTO_OWNERS,
  },
  {
    id: "autopilot_no_planning",
    displayName: "Autopilot (no planning)",
    description: "Agent-owned flow starting at implementation",
    planningMode: "skipped",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: AGENT_OWNERS,
  },
  {
    id: "autopilot_with_pr_no_planning",
    displayName: "Autopilot (PR, no planning)",
    description: "Agent-owned flow with PR output and no planning",
    planningMode: "skipped",
    implementationReviewMode: "required",
    output: "pr",
    owners: AGENT_OWNERS,
  },
  {
    id: "semiauto_no_planning",
    displayName: "Semiauto (no planning)",
    description: "Human-gated implementation review with skipped planning",
    planningMode: "skipped",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: SEMIAUTO_OWNERS,
  },
];

export function normalizeProfileId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === LEGACY_BEADS_COARSE_WORKFLOW_ID) return DEFAULT_PROFILE_ID;
  if (normalized === "beads-coarse-human-gated") return "semiauto";
  if (normalized === "automatic") return "autopilot";
  if (normalized === "workflow") return "semiauto";
  if (normalized === "knots-granular" || normalized === "knots-granular-autonomous") {
    return "autopilot";
  }
  if (normalized === "knots-coarse" || normalized === "knots-coarse-human-gated") {
    return "semiauto";
  }

  return normalized;
}

function canonicalTransitions(): Array<{ from: string; to: string }> {
  return [
    { from: "ready_for_planning", to: "planning" },
    { from: "planning", to: "ready_for_plan_review" },
    { from: "ready_for_plan_review", to: "plan_review" },
    { from: "plan_review", to: "ready_for_implementation" },
    { from: "plan_review", to: "ready_for_planning" },
    { from: "ready_for_implementation", to: "implementation" },
    { from: "implementation", to: "ready_for_implementation_review" },
    { from: "ready_for_implementation_review", to: "implementation_review" },
    { from: "implementation_review", to: "ready_for_shipment" },
    { from: "implementation_review", to: "ready_for_implementation" },
    { from: "ready_for_shipment", to: "shipment" },
    { from: "shipment", to: "ready_for_shipment_review" },
    { from: "ready_for_shipment_review", to: "shipment_review" },
    { from: "shipment_review", to: "shipped" },
    { from: "shipment_review", to: "ready_for_implementation" },
    { from: "shipment_review", to: "ready_for_shipment" },
    { from: "*", to: "deferred" },
    { from: "*", to: "abandoned" },
  ];
}

function buildStates(config: BuiltinProfileConfig): string[] {
  const states = [
    "ready_for_planning",
    "planning",
    "ready_for_plan_review",
    "plan_review",
    "ready_for_implementation",
    "implementation",
    "ready_for_implementation_review",
    "implementation_review",
    "ready_for_shipment",
    "shipment",
    "ready_for_shipment_review",
    "shipment_review",
    "shipped",
    "deferred",
    "abandoned",
  ];

  if (config.planningMode === "skipped") {
    return states.filter(
      (state) => !["ready_for_planning", "planning", "ready_for_plan_review", "plan_review"].includes(state),
    );
  }

  if (config.implementationReviewMode === "skipped") {
    return states.filter(
      (state) => !["ready_for_implementation_review", "implementation_review"].includes(state),
    );
  }

  return states;
}

function filterTransitionsForStates(
  states: string[],
  config: BuiltinProfileConfig,
): Array<{ from: string; to: string }> {
  const stateSet = new Set(states);
  const transitions = canonicalTransitions().filter((transition) =>
    (transition.from === "*" || stateSet.has(transition.from)) && stateSet.has(transition.to),
  );

  if (config.planningMode !== "required") {
    transitions.push({ from: "ready_for_planning", to: "ready_for_implementation" });
  }

  if (config.implementationReviewMode !== "required") {
    transitions.push({ from: "implementation", to: "ready_for_shipment" });
  }

  return transitions
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
    .filter((transition, index, all) => {
      if (index === 0) return true;
      const previous = all[index - 1];
      return previous.from !== transition.from || previous.to !== transition.to;
    });
}

function stepOwnerKind(
  workflow: MemoryWorkflowDescriptor,
  step: WorkflowStep,
): ActionOwnerKind {
  return workflow.owners?.[step] ?? "agent";
}

function modeForOwners(owners: MemoryWorkflowOwners): WorkflowMode {
  const hasHuman = Object.values(owners).some((ownerKind) => ownerKind === "human");
  return hasHuman ? "coarse_human_gated" : "granular_autonomous";
}

function descriptorFromProfileConfig(
  config: BuiltinProfileConfig,
  options?: { labelPrefix?: string },
): MemoryWorkflowDescriptor {
  const states = buildStates(config);
  const transitions = filterTransitionsForStates(states, config);
  const queueStates = states.filter((s) => resolveStep(s)?.phase === StepPhase.Queued);
  const actionStates = states.filter((s) => resolveStep(s)?.phase === StepPhase.Active);
  const reviewQueueStates = queueStates.filter((state) => {
    const resolved = resolveStep(state);
    return resolved ? resolved.step.endsWith("_review") : false;
  });
  const mode = modeForOwners(config.owners);
  const humanQueueStates = queueStates.filter((state) => {
    const resolved = resolveStep(state);
    if (!resolved) return false;
    return stepOwnerKind({ owners: config.owners } as MemoryWorkflowDescriptor, resolved.step) === "human";
  });
  const initialState = config.planningMode === "skipped"
    ? "ready_for_implementation"
    : "ready_for_planning";
  return {
    id: config.id,
    profileId: config.id,
    backingWorkflowId: config.id,
    label: options?.labelPrefix
      ? `${options.labelPrefix} (${config.id})`
      : config.displayName,
    mode,
    initialState,
    states,
    terminalStates: ["shipped", "abandoned"],
    transitions,
    finalCutState: humanQueueStates[0] ?? null,
    retakeState: states.includes("ready_for_implementation") ? "ready_for_implementation" : initialState,
    promptProfileId: config.id,
    owners: config.owners,
    queueStates,
    actionStates,
    reviewQueueStates,
    humanQueueStates,
  };
}

const BUILTIN_WORKFLOWS = BUILTIN_PROFILE_CATALOG.map((config) =>
  descriptorFromProfileConfig(config),
);

const BUILTIN_WORKFLOWS_BY_ID = new Map<string, MemoryWorkflowDescriptor>(
  BUILTIN_WORKFLOWS.map((workflow) => [workflow.id, workflow]),
);

function cloneWorkflowDescriptor(
  workflow: MemoryWorkflowDescriptor,
): MemoryWorkflowDescriptor {
  return {
    ...workflow,
    states: [...workflow.states],
    terminalStates: [...workflow.terminalStates],
    transitions: workflow.transitions
      ? workflow.transitions.map((t) => ({ ...t }))
      : undefined,
    owners: workflow.owners ? { ...workflow.owners } : undefined,
    queueStates: workflow.queueStates ? [...workflow.queueStates] : undefined,
    actionStates: workflow.actionStates ? [...workflow.actionStates] : undefined,
    reviewQueueStates: workflow.reviewQueueStates ? [...workflow.reviewQueueStates] : undefined,
    humanQueueStates: workflow.humanQueueStates ? [...workflow.humanQueueStates] : undefined,
  };
}

export function builtinWorkflowDescriptors(): MemoryWorkflowDescriptor[] {
  return BUILTIN_WORKFLOWS.map(cloneWorkflowDescriptor);
}

export function builtinProfileDescriptor(profileId?: string | null): MemoryWorkflowDescriptor {
  const normalized = normalizeProfileId(profileId) ?? DEFAULT_PROFILE_ID;
  const descriptor = BUILTIN_WORKFLOWS_BY_ID.get(normalized)
    ?? BUILTIN_WORKFLOWS_BY_ID.get(DEFAULT_PROFILE_ID)!;
  return cloneWorkflowDescriptor(descriptor);
}

export function defaultWorkflowDescriptor(): MemoryWorkflowDescriptor {
  return builtinProfileDescriptor(DEFAULT_PROFILE_ID);
}

export function isWorkflowStateLabel(label: string): boolean {
  return label.startsWith(WF_STATE_LABEL_PREFIX);
}

export function isWorkflowProfileLabel(label: string): boolean {
  return label.startsWith(WF_PROFILE_LABEL_PREFIX);
}

export function extractWorkflowStateLabel(labels: string[]): string | null {
  for (const label of labels) {
    if (!isWorkflowStateLabel(label)) continue;
    const raw = label.slice(WF_STATE_LABEL_PREFIX.length);
    const state = raw.trim().toLowerCase() || null;
    if (state) return state;
  }
  return null;
}

export function extractWorkflowProfileLabel(labels: string[]): string | null {
  for (const label of labels) {
    if (!isWorkflowProfileLabel(label)) continue;
    const profileId = normalizeProfileId(label.slice(WF_PROFILE_LABEL_PREFIX.length));
    if (profileId) return profileId;
  }
  return null;
}

export function withWorkflowStateLabel(labels: string[], workflowState: string): string[] {
  const next = labels.filter((label) => !isWorkflowStateLabel(label));
  const trimmed = workflowState?.trim().toLowerCase();
  const normalizedState = trimmed || "open";
  next.push(`${WF_STATE_LABEL_PREFIX}${normalizedState}`);
  return Array.from(new Set(next));
}

export function withWorkflowProfileLabel(labels: string[], profileId: string): string[] {
  const next = labels.filter((label) => !isWorkflowProfileLabel(label));
  const normalizedProfileId = normalizeProfileId(profileId) ?? DEFAULT_PROFILE_ID;
  next.push(`${WF_PROFILE_LABEL_PREFIX}${normalizedProfileId}`);
  return Array.from(new Set(next));
}

// ── Re-exports from workflows-runtime.ts ─────────────────────

export type { WorkflowRuntimeState } from "@/lib/workflows-runtime";

export {
  PROFILE_DESCRIPTIONS,
  profileDisplayName,
  mapWorkflowStateToCompatStatus,
  mapStatusToDefaultWorkflowState,
  normalizeStateForWorkflow,
  deriveProfileId,
  deriveWorkflowState,
  deriveBeadsProfileId,
  deriveBeadsWorkflowState,
  deriveWorkflowRuntimeState,
  inferWorkflowMode,
  inferFinalCutState,
  inferRetakeState,
  workflowDescriptorById,
  beatRequiresHumanAction,
  beatInFinalCut,
  beatInRetake,
  isQueueOrTerminal,
  compareWorkflowStatePriority,
  isRollbackTransition,
  forwardTransitionTarget,
} from "@/lib/workflows-runtime";

// ── Deprecated aliases (use backend-agnostic names above) ──
/** @deprecated Use DEFAULT_PROFILE_ID */
export const DEFAULT_BEADS_PROFILE_ID = DEFAULT_PROFILE_ID;
/** @deprecated Use DEFAULT_WORKFLOW_ID */
export const BEADS_COARSE_WORKFLOW_ID = DEFAULT_WORKFLOW_ID;
/** @deprecated Use DEFAULT_PROMPT_PROFILE_ID */
export const BEADS_COARSE_PROMPT_PROFILE_ID =
  DEFAULT_PROMPT_PROFILE_ID;
/** @deprecated Use builtinWorkflowDescriptors */
export const beadsProfileWorkflowDescriptors =
  builtinWorkflowDescriptors;
/** @deprecated Use builtinProfileDescriptor */
export const beadsProfileDescriptor = builtinProfileDescriptor;
/** @deprecated Use defaultWorkflowDescriptor */
export const beadsCoarseWorkflowDescriptor =
  defaultWorkflowDescriptor;
