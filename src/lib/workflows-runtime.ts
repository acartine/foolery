/**
 * Workflow runtime state derivation, beat helpers, compat-status
 * mapping, pipeline ordering, and transition helpers.
 *
 * Extracted from workflows.ts to stay within the 500-line limit.
 */
import type {
  ActionOwnerKind,
  Beat,
  MemoryWorkflowDescriptor,
  WorkflowMode,
} from "@/lib/types";
import { recordCompatStatusSerialized } from "@/lib/compat-status-usage";
import {
  resolveStep,
  StepPhase,
  type WorkflowStep,
  normalizeProfileId,
  extractWorkflowProfileLabel,
  extractWorkflowStateLabel,
  builtinProfileDescriptor,
  DEFAULT_PROFILE_ID,
} from "@/lib/workflows";

/** Human-friendly short descriptions for built-in profile IDs. */
export const PROFILE_DESCRIPTIONS: Readonly<
  Record<string, string>
> = {
  autopilot:
    "Fully autonomous agent flow: planning, implementation, " +
    "and shipment are all agent-owned. Output goes to remote main.",
  autopilot_with_pr:
    "Fully autonomous agent flow with pull request output " +
    "instead of direct push to main.",
  semiauto:
    "Agent does the work, but a human reviews the plan " +
    "and implementation before it proceeds.",
  autopilot_no_planning:
    "Autonomous agent flow that skips planning " +
    "and jumps straight to implementation.",
  autopilot_with_pr_no_planning:
    "Autonomous agent flow with PR output and no planning phase.",
  semiauto_no_planning:
    "Human-gated implementation review with no planning phase.",
};

/** Returns a human-friendly display name for a profile ID. */
export function profileDisplayName(
  profileId: string,
): string {
  const DISPLAY_NAMES: Readonly<Record<string, string>> = {
    autopilot: "Autopilot",
    autopilot_with_pr: "Autopilot (PR)",
    semiauto: "Semiauto",
    autopilot_no_planning: "Autopilot (no planning)",
    autopilot_with_pr_no_planning: "Autopilot (PR, no planning)",
    semiauto_no_planning: "Semiauto (no planning)",
    automatic: "Autopilot",
    workflow: "Semiauto",
  };
  const normalized = normalizeProfileId(profileId) ?? profileId;
  return DISPLAY_NAMES[normalized] ?? normalized;
}

const TERMINAL_STATUS_STATES = new Set<string>([
  "shipped",
  "abandoned",
  "closed",
]);
const LEGACY_TERMINAL_STATES = new Set<string>([
  "closed",
  "done",
  "approved",
]);
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

// ── Internal helpers ─────────────────────────────────────────

function normalizeState(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function firstActionState(
  workflow?: MemoryWorkflowDescriptor,
): string {
  if (
    workflow?.actionStates &&
    workflow.actionStates.length > 0
  ) {
    return workflow.actionStates[0]!;
  }
  if (workflow?.states?.includes("implementation")) {
    return "implementation";
  }
  return "in_progress";
}

function terminalStateForStatus(
  status: string,
  workflow?: MemoryWorkflowDescriptor,
): string {
  if (status === "deferred") {
    if (workflow?.states.includes("deferred")) return "deferred";
    return "deferred";
  }

  if (workflow?.states.includes("shipped")) return "shipped";
  if (workflow?.terminalStates.includes("closed")) {
    return "closed";
  }
  if (workflow?.terminalStates.length) {
    return workflow.terminalStates[0]!;
  }
  return "closed";
}

function stepOwnerKind(
  workflow: MemoryWorkflowDescriptor,
  step: WorkflowStep,
): ActionOwnerKind {
  return workflow.owners?.[step] ?? "agent";
}

// ── Compat-status mapping ────────────────────────────────────

/** @internal Beats-backend compat: maps workflow state to status. */
export function mapWorkflowStateToCompatStatus(
  workflowState: string,
  context = "workflow-state",
): string {
  recordCompatStatusSerialized(context);
  const normalized = normalizeState(workflowState);
  if (!normalized) return "open";

  if (normalized === "deferred") return "deferred";
  if (normalized === "blocked" || normalized === "rejected") {
    return "blocked";
  }
  if (
    TERMINAL_STATUS_STATES.has(normalized) ||
    LEGACY_TERMINAL_STATES.has(normalized)
  ) {
    return "closed";
  }
  const resolved = resolveStep(normalized);
  if (resolved?.phase === StepPhase.Queued) return "open";
  if (
    resolved?.phase === StepPhase.Active ||
    LEGACY_IN_PROGRESS_STATES.has(normalized)
  ) {
    return "in_progress";
  }
  if (normalized === "open") return "open";
  return "open";
}

/** @internal Beats-backend compat: maps status to workflow state. */
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

// ── State normalization ──────────────────────────────────────

function remapLegacyStateForProfile(
  rawState: string,
  workflow: MemoryWorkflowDescriptor,
): string {
  const normalized = normalizeState(rawState);
  if (!normalized) return workflow.initialState;
  if (workflow.states.includes(normalized)) return normalized;

  if (normalized === "impl") {
    if (workflow.states.includes("implementation")) {
      return "implementation";
    }
    return firstActionState(workflow);
  }

  if (normalized === "shipped" || normalized === "abandoned") {
    return normalized;
  }

  if (
    normalized === "open" ||
    normalized === "idea" ||
    normalized === "work_item"
  ) {
    return workflow.initialState;
  }

  if (LEGACY_IN_PROGRESS_STATES.has(normalized)) {
    return firstActionState(workflow);
  }

  if (
    normalized === "ready_for_review" ||
    normalized === "reviewing"
  ) {
    if (
      workflow.states.includes("ready_for_implementation_review")
    ) {
      return "ready_for_implementation_review";
    }
    return firstActionState(workflow);
  }

  if (LEGACY_RETAKE_STATES.has(normalized)) {
    if (workflow.states.includes(workflow.retakeState)) {
      return workflow.retakeState;
    }
    return workflow.initialState;
  }

  if (
    normalized === "closed" ||
    normalized === "done" ||
    normalized === "approved"
  ) {
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

// ── Profile / state derivation ───────────────────────────────

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
      ].find(
        (v) => typeof v === "string" && v.trim().length > 0,
      )
    : undefined;

  const normalizedFromMetadata =
    typeof fromMetadata === "string"
      ? normalizeProfileId(fromMetadata)
      : null;
  if (normalizedFromMetadata) return normalizedFromMetadata;

  const explicit = extractWorkflowProfileLabel(labels ?? []);
  return explicit ?? DEFAULT_PROFILE_ID;
}

function hasExplicitProfileSelection(
  labels: string[] | undefined,
  metadata?: Record<string, unknown>,
): boolean {
  if (extractWorkflowProfileLabel(labels ?? [])) return true;
  if (!metadata) return false;
  return [
    metadata.profileId,
    metadata.fooleryProfileId,
    metadata.workflowProfileId,
    metadata.knotsProfileId,
  ].some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
}

export function deriveWorkflowState(
  status: string | undefined,
  labels: string[] | undefined,
  workflow?: MemoryWorkflowDescriptor,
): string {
  const nextLabels = labels ?? [];
  const descriptor =
    workflow ?? builtinProfileDescriptor(DEFAULT_PROFILE_ID);

  const explicit = extractWorkflowStateLabel(nextLabels);
  if (explicit) {
    return normalizeStateForWorkflow(explicit, descriptor);
  }

  if (status) {
    return mapStatusToDefaultWorkflowState(status, descriptor);
  }
  return descriptor.initialState;
}

export function deriveBeadsProfileId(
  labels: string[] | undefined,
  metadata?: Record<string, unknown>,
): string {
  const explicit = deriveProfileId(labels, metadata);
  if (hasExplicitProfileSelection(labels, metadata)) {
    return explicit;
  }
  return "autopilot_no_planning";
}

export function deriveBeadsWorkflowState(
  status: string | undefined,
  labels: string[] | undefined,
  metadata?: Record<string, unknown>,
): string {
  const profileId = deriveBeadsProfileId(labels, metadata);
  const workflow = builtinProfileDescriptor(profileId);
  return deriveWorkflowState(status, labels, workflow);
}

// ── Runtime state derivation ─────────────────────────────────

function ownerForCurrentState(
  state: string,
  workflow: MemoryWorkflowDescriptor,
): { nextActionState?: string; ownerKind: ActionOwnerKind } {
  const resolved = resolveStep(state);
  if (!resolved) return { ownerKind: "none" };
  return {
    nextActionState: resolved.step,
    ownerKind: stepOwnerKind(workflow, resolved.step),
  };
}

export interface WorkflowRuntimeState {
  state: string;
  /** @internal Beats-backend compat. */
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
  const normalizedState = normalizeStateForWorkflow(
    workflowState,
    workflow,
  );
  const owner = ownerForCurrentState(normalizedState, workflow);
  const resolved = resolveStep(normalizedState);

  return {
    state: normalizedState,
    compatStatus: mapWorkflowStateToCompatStatus(normalizedState),
    nextActionState: owner.nextActionState,
    nextActionOwnerKind: owner.ownerKind,
    requiresHumanAction: owner.ownerKind === "human",
    isAgentClaimable:
      resolved?.phase === StepPhase.Queued &&
      owner.ownerKind === "agent",
  };
}

// ── Inference helpers ────────────────────────────────────────

export function inferWorkflowMode(
  workflowId: string,
  description?: string | null,
  states?: string[],
): WorkflowMode {
  const hint = [
    workflowId,
    description ?? "",
    (states ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  if (
    /(semiauto|coarse|human|gated|pull request|pr\b)/.test(hint)
  ) {
    return "coarse_human_gated";
  }
  return "granular_autonomous";
}

// ── Beat helpers ─────────────────────────────────────────────

import { resolveWorkflowForBeat } from "@/lib/workflows-pipeline";

export {
  workflowDescriptorById,
  inferFinalCutState,
  inferRetakeState,
} from "@/lib/workflows-pipeline";

export function beatRequiresHumanAction(
  beat: Beat,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): boolean {
  if (typeof beat.requiresHumanAction === "boolean") {
    return beat.requiresHumanAction;
  }
  const workflow = resolveWorkflowForBeat(beat, workflowsById);
  if (!workflow) return false;
  return deriveWorkflowRuntimeState(workflow, beat.state)
    .requiresHumanAction;
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

/**
 * Returns true when the state is a queue or terminal state.
 * An agent must never end a work iteration in an active state.
 */
export function isQueueOrTerminal(
  state: string,
  workflow?: MemoryWorkflowDescriptor,
): boolean {
  const terminalStates =
    workflow?.terminalStates ?? [
      "shipped",
      "abandoned",
      "closed",
    ];
  if (terminalStates.includes(state)) return true;
  if (state === "deferred") return true;
  const resolved = resolveStep(state);
  if (!resolved) return true;
  return resolved.phase === StepPhase.Queued;
}

// ── Pipeline ordering (re-exported) ──────────────────────────

export {
  compareWorkflowStatePriority,
  isRollbackTransition,
  forwardTransitionTarget,
} from "@/lib/workflows-pipeline";
