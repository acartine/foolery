import type {
  ActionOwnerKind,
  Beat,
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
  WorkflowMode,
} from "@/lib/types";
import { recordCompatStatusSerialized } from "@/lib/compat-status-usage";

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

const ACTION_STATES = [
  "planning",
  "plan_review",
  "implementation",
  "implementation_review",
  "shipment",
  "shipment_review",
] as const;

const REVIEW_ACTION_STATES = new Set<string>([
  "plan_review",
  "implementation_review",
  "shipment_review",
]);

const ACTION_STATE_SET = new Set<string>(ACTION_STATES);
const TERMINAL_STATUS_STATES = new Set<string>(["shipped", "abandoned", "closed"]);
const LEGACY_TERMINAL_STATES = new Set<string>(["closed", "done", "approved"]);
const LEGACY_RETAKE_STATES = new Set<string>([
  "retake",
  "retry",
  "rejected",
  "refining",
  "rework",
]);
const LEGACY_IN_PROGRESS_STATES = new Set<string>([
  "in_progress",
  "implementing",
  "implemented",
  "reviewing",
]);

const OWNER_BY_ACTION_STATE: Record<string, keyof MemoryWorkflowOwners> = {
  planning: "planning",
  plan_review: "plan_review",
  implementation: "implementation",
  implementation_review: "implementation_review",
  shipment: "shipment",
  shipment_review: "shipment_review",
};

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

interface BuiltinProfileConfig {
  id: string;
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
    description: "Agent-owned full flow with remote main output",
    planningMode: "required",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: AGENT_OWNERS,
  },
  {
    id: "autopilot_with_pr",
    description: "Agent-owned full flow with PR output",
    planningMode: "required",
    implementationReviewMode: "required",
    output: "pr",
    owners: AGENT_OWNERS,
  },
  {
    id: "semiauto",
    description: "Human-gated plan and implementation reviews",
    planningMode: "required",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: SEMIAUTO_OWNERS,
  },
  {
    id: "autopilot_no_planning",
    description: "Agent-owned flow starting at implementation",
    planningMode: "skipped",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: AGENT_OWNERS,
  },
  {
    id: "autopilot_with_pr_no_planning",
    description: "Agent-owned flow with PR output and no planning",
    planningMode: "skipped",
    implementationReviewMode: "required",
    output: "pr",
    owners: AGENT_OWNERS,
  },
  {
    id: "semiauto_no_planning",
    description: "Human-gated implementation review with skipped planning",
    planningMode: "skipped",
    implementationReviewMode: "required",
    output: "remote_main",
    owners: SEMIAUTO_OWNERS,
  },
];

function normalizeState(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeProfileId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === LEGACY_BEADS_COARSE_WORKFLOW_ID) return DEFAULT_PROFILE_ID;
  if (normalized === "beads-coarse-human-gated") return "semiauto";
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

function filterTransitionsForStates(states: string[], config: BuiltinProfileConfig): Array<{ from: string; to: string }> {
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

function queueStatesFrom(states: string[]): string[] {
  return states.filter((state) => state.startsWith("ready_for_"));
}

function actionStatesFrom(states: string[]): string[] {
  return states.filter((state) => ACTION_STATE_SET.has(state));
}

function queueStateToActionState(queueState: string): string | null {
  if (!queueState.startsWith("ready_for_")) return null;
  const action = queueState.slice("ready_for_".length);
  return ACTION_STATE_SET.has(action) ? action : null;
}

function actionOwnerKind(workflow: MemoryWorkflowDescriptor, actionState: string): ActionOwnerKind {
  const ownerKey = OWNER_BY_ACTION_STATE[actionState];
  if (!ownerKey) return "none";
  return workflow.owners?.[ownerKey] ?? "agent";
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
  const queueStates = queueStatesFrom(states);
  const actionStates = actionStatesFrom(states);
  const reviewQueueStates = queueStates.filter((state) => {
    const actionState = queueStateToActionState(state);
    return actionState ? REVIEW_ACTION_STATES.has(actionState) : false;
  });
  const mode = modeForOwners(config.owners);
  const humanQueueStates = queueStates.filter((state) => {
    const actionState = queueStateToActionState(state);
    if (!actionState) return false;
    return actionOwnerKind({ owners: config.owners } as MemoryWorkflowDescriptor, actionState) === "human";
  });
  const initialState = config.planningMode === "skipped"
    ? "ready_for_implementation"
    : "ready_for_planning";
  const labelPrefix = options?.labelPrefix ?? "Workflow";

  return {
    id: config.id,
    profileId: config.id,
    backingWorkflowId: config.id,
    label: `${labelPrefix} (${config.id})`,
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

function cloneWorkflowDescriptor(workflow: MemoryWorkflowDescriptor): MemoryWorkflowDescriptor {
  return {
    ...workflow,
    states: [...workflow.states],
    terminalStates: [...workflow.terminalStates],
    transitions: workflow.transitions ? workflow.transitions.map((transition) => ({ ...transition })) : undefined,
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
    const state = normalizeState(label.slice(WF_STATE_LABEL_PREFIX.length));
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
  const normalizedState = normalizeState(workflowState) ?? "open";
  next.push(`${WF_STATE_LABEL_PREFIX}${normalizedState}`);
  return Array.from(new Set(next));
}

export function withWorkflowProfileLabel(labels: string[], profileId: string): string[] {
  const next = labels.filter((label) => !isWorkflowProfileLabel(label));
  const normalizedProfileId = normalizeProfileId(profileId) ?? DEFAULT_PROFILE_ID;
  next.push(`${WF_PROFILE_LABEL_PREFIX}${normalizedProfileId}`);
  return Array.from(new Set(next));
}

function firstActionState(workflow?: MemoryWorkflowDescriptor): string {
  if (workflow?.actionStates && workflow.actionStates.length > 0) {
    return workflow.actionStates[0]!;
  }
  if (workflow?.states?.includes("implementation")) return "implementation";
  return "in_progress";
}

/** @internal Used by beads backend for compat-status translation. */
function terminalStateForStatus(status: string, workflow?: MemoryWorkflowDescriptor): string {
  if (status === "deferred") {
    if (workflow?.states.includes("deferred")) return "deferred";
    return "deferred";
  }

  if (workflow?.states.includes("shipped")) return "shipped";
  if (workflow?.terminalStates.includes("closed")) return "closed";
  if (workflow?.terminalStates.length) return workflow.terminalStates[0]!;
  return "closed";
}

/** @internal Beads-backend compat: maps workflow state to simple status. */
export function mapWorkflowStateToCompatStatus(
  workflowState: string,
  context = "workflow-state",
): string {
  recordCompatStatusSerialized(context);
  const normalized = normalizeState(workflowState);
  if (!normalized) return "open";

  if (normalized === "deferred") return "deferred";
  if (normalized === "blocked" || normalized === "rejected") return "blocked";
  if (TERMINAL_STATUS_STATES.has(normalized) || LEGACY_TERMINAL_STATES.has(normalized)) {
    return "closed";
  }
  if (normalized.startsWith("ready_for_")) return "open";
  if (ACTION_STATE_SET.has(normalized) || LEGACY_IN_PROGRESS_STATES.has(normalized)) {
    return "in_progress";
  }
  if (normalized === "open") return "open";
  return "open";
}

/** @internal Beads-backend compat: maps simple status to workflow state. */
export function mapStatusToDefaultWorkflowState(
  status: string,
  workflow?: MemoryWorkflowDescriptor,
): string {
  switch (status) {
    case "closed":
      return terminalStateForStatus("closed", workflow);
    case "deferred":
      return terminalStateForStatus("deferred", workflow);
    case "blocked":
      return workflow?.retakeState ?? "blocked";
    case "in_progress":
      return firstActionState(workflow);
    case "open":
    default:
      return workflow?.initialState ?? "open";
  }
}

function remapLegacyStateForProfile(
  rawState: string,
  workflow: MemoryWorkflowDescriptor,
): string {
  const normalized = normalizeState(rawState);
  if (!normalized) return workflow.initialState;
  if (workflow.states.includes(normalized)) return normalized;

  if (normalized === "open" || normalized === "idea" || normalized === "work_item") {
    return workflow.initialState;
  }

  if (LEGACY_IN_PROGRESS_STATES.has(normalized)) {
    return firstActionState(workflow);
  }

  if (normalized === "verification" || normalized === "ready_for_review" || normalized === "reviewing") {
    if (workflow.states.includes("ready_for_implementation_review")) {
      return "ready_for_implementation_review";
    }
    return firstActionState(workflow);
  }

  if (LEGACY_RETAKE_STATES.has(normalized)) {
    if (workflow.states.includes(workflow.retakeState)) return workflow.retakeState;
    return workflow.initialState;
  }

  if (normalized === "closed" || normalized === "done" || normalized === "approved") {
    return terminalStateForStatus("closed", workflow);
  }

  if (normalized === "deferred") {
    return terminalStateForStatus("deferred", workflow);
  }

  return workflow.initialState;
}

export function normalizeStateForWorkflow(
  workflowState: string | undefined,
  workflow: MemoryWorkflowDescriptor,
): string {
  const normalized = normalizeState(workflowState);
  if (!normalized) return workflow.initialState;
  return remapLegacyStateForProfile(normalized, workflow);
}

export function deriveProfileId(
  labels: string[] | undefined,
  metadata?: Record<string, unknown>,
): string {
  const fromMetadata = metadata
    ? [
      metadata.profileId,
      metadata.fooleryProfileId,
      metadata.workflowProfileId,
      metadata.knotsProfileId,
    ]
      .find((value) => typeof value === "string" && value.trim().length > 0)
    : undefined;

  const normalizedFromMetadata = typeof fromMetadata === "string"
    ? normalizeProfileId(fromMetadata)
    : null;
  if (normalizedFromMetadata) return normalizedFromMetadata;

  const explicit = extractWorkflowProfileLabel(labels ?? []);
  return explicit ?? DEFAULT_PROFILE_ID;
}

export function deriveWorkflowState(
  status: string | undefined,
  labels: string[] | undefined,
  workflow?: MemoryWorkflowDescriptor,
): string {
  const nextLabels = labels ?? [];
  const descriptor = workflow ?? builtinProfileDescriptor(DEFAULT_PROFILE_ID);

  const explicit = extractWorkflowStateLabel(nextLabels);
  if (explicit) return normalizeStateForWorkflow(explicit, descriptor);

  if (nextLabels.includes("stage:verification")) {
    return normalizeStateForWorkflow("ready_for_implementation_review", descriptor);
  }
  if (nextLabels.includes("stage:retry")) {
    return normalizeStateForWorkflow(descriptor.retakeState, descriptor);
  }
  if (status) return mapStatusToDefaultWorkflowState(status, descriptor);
  return descriptor.initialState;
}

function ownerForCurrentState(
  state: string,
  workflow: MemoryWorkflowDescriptor,
): { nextActionState?: string; ownerKind: ActionOwnerKind } {
  if (state.startsWith("ready_for_")) {
    const actionState = queueStateToActionState(state);
    if (actionState) {
      return {
        nextActionState: actionState,
        ownerKind: actionOwnerKind(workflow, actionState),
      };
    }
  }

  if (ACTION_STATE_SET.has(state)) {
    return {
      nextActionState: state,
      ownerKind: actionOwnerKind(workflow, state),
    };
  }

  return { ownerKind: "none" };
}

export interface WorkflowRuntimeState {
  state: string;
  /** @internal Beads-backend compat: simple status derived from state. */
  compatStatus: string;
  nextActionState?: string;
  nextActionOwnerKind: ActionOwnerKind;
  requiresHumanAction: boolean;
  isAgentClaimable: boolean;
}

export function deriveWorkflowRuntimeState(
  workflow: MemoryWorkflowDescriptor,
  workflowState: string | undefined,
): WorkflowRuntimeState {
  const normalizedState = normalizeStateForWorkflow(workflowState, workflow);
  const owner = ownerForCurrentState(normalizedState, workflow);
  const isQueueState = normalizedState.startsWith("ready_for_");

  return {
    state: normalizedState,
    compatStatus: mapWorkflowStateToCompatStatus(normalizedState),
    nextActionState: owner.nextActionState,
    nextActionOwnerKind: owner.ownerKind,
    requiresHumanAction: owner.ownerKind === "human",
    isAgentClaimable: isQueueState && owner.ownerKind === "agent",
  };
}

export function inferWorkflowMode(
  workflowId: string,
  description?: string | null,
  states?: string[],
): WorkflowMode {
  const hint = [workflowId, description ?? "", (states ?? []).join(" ")]
    .join(" ")
    .toLowerCase();
  if (/(semiauto|coarse|human|gated|pull request|pr\b)/.test(hint)) {
    return "coarse_human_gated";
  }
  return "granular_autonomous";
}

export function inferFinalCutState(states: string[]): string | null {
  const preferred = [
    "ready_for_plan_review",
    "ready_for_implementation_review",
    "ready_for_shipment_review",
    "verification",
    "reviewing",
  ];
  for (const candidate of preferred) {
    if (states.includes(candidate)) return candidate;
  }
  return null;
}

export function inferRetakeState(states: string[], initialState: string): string {
  const preferred = ["ready_for_implementation", "retake", "retry", "rejected", "refining"];
  for (const candidate of preferred) {
    if (states.includes(candidate)) return candidate;
  }
  return initialState;
}

export function workflowDescriptorById(
  workflows: MemoryWorkflowDescriptor[],
): Map<string, MemoryWorkflowDescriptor> {
  const map = new Map<string, MemoryWorkflowDescriptor>();
  for (const workflow of workflows) {
    map.set(workflow.id, workflow);
    map.set(workflow.backingWorkflowId, workflow);
    if (workflow.profileId) map.set(workflow.profileId, workflow);
  }

  const autopilot = workflows.find((workflow) => workflow.id === "autopilot");
  if (autopilot) {
    map.set(LEGACY_BEADS_COARSE_WORKFLOW_ID, autopilot);
    map.set("knots-granular", autopilot);
    map.set("knots-granular-autonomous", autopilot);
  }

  const semiauto = workflows.find((workflow) => workflow.id === "semiauto");
  if (semiauto) {
    map.set("knots-coarse", semiauto);
    map.set("knots-coarse-human-gated", semiauto);
    map.set("beads-coarse-human-gated", semiauto);
  }

  return map;
}

function resolveWorkflowForBeat(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): MemoryWorkflowDescriptor | null {
  const profileId = normalizeProfileId(beat.profileId);
  if (profileId && workflowsById.has(profileId)) return workflowsById.get(profileId)!;
  if (beat.workflowId && workflowsById.has(beat.workflowId)) return workflowsById.get(beat.workflowId)!;
  return null;
}

export function beatRequiresHumanAction(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): boolean {
  if (typeof beat.requiresHumanAction === "boolean") return beat.requiresHumanAction;
  const workflow = resolveWorkflowForBeat(beat, workflowsById);
  if (!workflow) return false;
  return deriveWorkflowRuntimeState(workflow, beat.state).requiresHumanAction;
}

export function beatInFinalCut(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): boolean {
  return beatRequiresHumanAction(beat, workflowsById);
}

export function beatInRetake(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): boolean {
  const normalized = normalizeState(beat.state) ?? "";
  if (LEGACY_RETAKE_STATES.has(normalized)) return true;

  const workflow = resolveWorkflowForBeat(beat, workflowsById);
  if (!workflow) return false;
  return normalizeState(workflow.retakeState) === normalized;
}

// ── Deprecated aliases (use backend-agnostic names above) ──────

/** @deprecated Use DEFAULT_PROFILE_ID */
export const DEFAULT_BEADS_PROFILE_ID = DEFAULT_PROFILE_ID;
/** @deprecated Use DEFAULT_WORKFLOW_ID */
export const BEADS_COARSE_WORKFLOW_ID = DEFAULT_WORKFLOW_ID;
/** @deprecated Use DEFAULT_PROMPT_PROFILE_ID */
export const BEADS_COARSE_PROMPT_PROFILE_ID = DEFAULT_PROMPT_PROFILE_ID;

/** @deprecated Use builtinWorkflowDescriptors */
export const beadsProfileWorkflowDescriptors = builtinWorkflowDescriptors;
/** @deprecated Use builtinProfileDescriptor */
export const beadsProfileDescriptor = builtinProfileDescriptor;
/** @deprecated Use defaultWorkflowDescriptor */
export const beadsCoarseWorkflowDescriptor = defaultWorkflowDescriptor;
/** @deprecated Use deriveProfileId */
export const deriveBeadsProfileId = deriveProfileId;
/** @deprecated Use deriveWorkflowState */
export const deriveBeadsWorkflowState = deriveWorkflowState;

