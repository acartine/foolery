/**
 * Beads-only compat-status translation.
 *
 * This module exists as migration debt for the Beads JSONL backend, which
 * serializes issues with a generic status field ("open", "in_progress",
 * "blocked", "deferred", "closed") rather than Foolery's workflow-native
 * states. Nothing outside the Beads backend should import from here.
 *
 * Foolery run paths (execution-plan, Knots backend, UI) express behavior
 * directly in workflow-native states. Do not add new consumers to this
 * module.
 */
import type {
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import {
  resolveStep,
  StepPhase,
  extractWorkflowProfileLabel,
  extractWorkflowStateLabel,
  normalizeProfileId,
  normalizeStateForWorkflow,
  builtinProfileDescriptor,
  DEFAULT_PROFILE_ID,
} from "@/lib/workflows";

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
const LEGACY_IN_PROGRESS_STATES = new Set<string>([
  "in_progress",
  "implementing",
  "implemented",
  "reviewing",
]);

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

/**
 * Maps a workflow-native state to the Beads-serialized status string.
 * Used only at the Beads JSONL/CLI boundary.
 */
export function mapWorkflowStateToCompatStatus(
  workflowState: string,
): string {
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

/**
 * Maps a Beads-serialized status back to the default workflow-native state
 * for the given descriptor. Used only when reading Beads input that
 * provides a status with no workflow-state label.
 */
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

function deriveProfileIdFromInputs(
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

/**
 * Beads default profile selection: unlabeled Beads records default to the
 * no-planning profile rather than the full-planning default.
 */
export function deriveBeadsProfileId(
  labels: string[] | undefined,
  metadata?: Record<string, unknown>,
): string {
  const explicit = deriveProfileIdFromInputs(labels, metadata);
  if (hasExplicitProfileSelection(labels, metadata)) {
    return explicit;
  }
  return "autopilot_no_planning";
}

/**
 * Resolves a Beads record's workflow state from its status, labels, and
 * metadata. When no workflow-state label is present the serialized
 * status is used to pick a default state in the resolved profile.
 */
export function deriveBeadsWorkflowState(
  status: string | undefined,
  labels: string[] | undefined,
  metadata?: Record<string, unknown>,
): string {
  const profileId = deriveBeadsProfileId(labels, metadata);
  const workflow = builtinProfileDescriptor(profileId);
  const nextLabels = labels ?? [];
  const explicit = extractWorkflowStateLabel(nextLabels);
  if (explicit) {
    return normalizeStateForWorkflow(explicit, workflow);
  }
  if (status) {
    return mapStatusToDefaultWorkflowState(status, workflow);
  }
  return workflow.initialState;
}
