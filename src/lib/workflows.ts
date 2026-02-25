import type {
  Bead,
  BeadStatus,
  CoarsePrPreference,
  MemoryWorkflowDescriptor,
  WorkflowMode,
} from "@/lib/types";
import { recordCompatStatusSerialized } from "@/lib/compat-status-usage";

export const WF_STATE_LABEL_PREFIX = "wf:state:";

export const BEADS_COARSE_WORKFLOW_ID = "beads-coarse";
export const BEADS_COARSE_PROMPT_PROFILE_ID = "beads-coarse-human-gated";

export const KNOTS_GRANULAR_DESCRIPTOR_ID = "knots-granular";
export const KNOTS_COARSE_DESCRIPTOR_ID = "knots-coarse";
export const KNOTS_GRANULAR_PROMPT_PROFILE_ID = "knots-granular-autonomous";
export const KNOTS_COARSE_PROMPT_PROFILE_ID = "knots-coarse-human-gated";

export const DEFAULT_COARSE_PR_PREFERENCE: CoarsePrPreference = "soft_required";

const BEADS_COARSE_STATE_TO_STATUS: Record<string, BeadStatus> = {
  open: "open",
  in_progress: "in_progress",
  blocked: "blocked",
  deferred: "deferred",
  closed: "closed",
  verification: "in_progress",
  retake: "open",
};

const STATUS_TO_BEADS_COARSE_STATE: Record<BeadStatus, string> = {
  open: "open",
  in_progress: "in_progress",
  blocked: "blocked",
  deferred: "deferred",
  closed: "closed",
};

function normalizeState(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function isWorkflowStateLabel(label: string): boolean {
  return label.startsWith(WF_STATE_LABEL_PREFIX);
}

export function extractWorkflowStateLabel(labels: string[]): string | null {
  for (const label of labels) {
    if (!isWorkflowStateLabel(label)) continue;
    const state = normalizeState(label.slice(WF_STATE_LABEL_PREFIX.length));
    if (state) return state;
  }
  return null;
}

export function withWorkflowStateLabel(labels: string[], workflowState: string): string[] {
  const next = labels.filter((label) => !isWorkflowStateLabel(label));
  const normalizedState = normalizeState(workflowState) ?? "open";
  next.push(`${WF_STATE_LABEL_PREFIX}${normalizedState}`);
  return Array.from(new Set(next));
}

export function mapWorkflowStateToCompatStatus(
  workflowState: string,
  context = "workflow-state",
): BeadStatus {
  recordCompatStatusSerialized(context);
  return BEADS_COARSE_STATE_TO_STATUS[workflowState] ?? "open";
}

export function mapStatusToDefaultWorkflowState(status: BeadStatus): string {
  return STATUS_TO_BEADS_COARSE_STATE[status] ?? "open";
}

export function deriveBeadsWorkflowState(
  status: BeadStatus | undefined,
  labels: string[] | undefined,
): string {
  const nextLabels = labels ?? [];
  const explicit = extractWorkflowStateLabel(nextLabels);
  if (explicit) return explicit;
  if (nextLabels.includes("stage:verification")) return "verification";
  if (nextLabels.includes("stage:retry")) return "retake";
  if (status) return mapStatusToDefaultWorkflowState(status);
  return "open";
}

export function beadsCoarseWorkflowDescriptor(): MemoryWorkflowDescriptor {
  return {
    id: BEADS_COARSE_WORKFLOW_ID,
    backingWorkflowId: BEADS_COARSE_WORKFLOW_ID,
    label: "Beads (Coarse, Human-Gated)",
    mode: "coarse_human_gated",
    initialState: "open",
    states: [
      "open",
      "in_progress",
      "verification",
      "retake",
      "blocked",
      "deferred",
      "closed",
    ],
    terminalStates: ["closed", "deferred"],
    finalCutState: "verification",
    retakeState: "retake",
    promptProfileId: BEADS_COARSE_PROMPT_PROFILE_ID,
    coarsePrPreferenceDefault: DEFAULT_COARSE_PR_PREFERENCE,
  };
}

function hintString(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function inferWorkflowMode(
  workflowId: string,
  description?: string | null,
  states?: string[],
): WorkflowMode {
  const hint = hintString(workflowId, description, states?.join(" "));
  if (/(coarse|human|gated|pull request|pr\b|review)/.test(hint)) {
    return "coarse_human_gated";
  }
  if (/(granular|autonomous|auto|direct[-_ ]to[-_ ]main|unsupervised)/.test(hint)) {
    return "granular_autonomous";
  }
  return "granular_autonomous";
}

export function inferFinalCutState(states: string[]): string | null {
  const normalized = states.map((state) => state.trim().toLowerCase());
  const preferred = [
    "reviewing",
    "review",
    "ready_for_review",
    "verification",
    "final_cut",
  ];
  for (const candidate of preferred) {
    if (normalized.includes(candidate)) return candidate;
  }
  return null;
}

export function inferRetakeState(states: string[], initialState: string): string {
  const normalized = states.map((state) => state.trim().toLowerCase());
  const preferred = [
    "retake",
    "rejected",
    "retry",
    "rework",
    "refining",
  ];
  for (const candidate of preferred) {
    if (normalized.includes(candidate)) return candidate;
  }
  return normalizeState(initialState) ?? "open";
}

export function workflowDescriptorById(
  workflows: MemoryWorkflowDescriptor[],
): Map<string, MemoryWorkflowDescriptor> {
  return new Map(workflows.map((workflow) => [workflow.id, workflow]));
}

export function beadInFinalCut(
  bead: Bead,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): boolean {
  if (!bead.workflowId || !bead.workflowState) return false;
  const workflow = workflowsById.get(bead.workflowId);
  if (!workflow || !workflow.finalCutState) return false;
  return bead.workflowState === workflow.finalCutState;
}

export function beadInRetake(
  bead: Bead,
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): boolean {
  if (!bead.workflowId || !bead.workflowState) return false;
  const workflow = workflowsById.get(bead.workflowId);
  if (!workflow) return false;
  return bead.workflowState === workflow.retakeState;
}

export function coarseOverrideKey(repoPath: string, workflowId: string): string {
  return `${repoPath}::${workflowId}`;
}

export function resolveCoarsePrPreference(
  repoPath: string | undefined,
  workflow: MemoryWorkflowDescriptor,
  overrides: Record<string, CoarsePrPreference>,
): CoarsePrPreference {
  if (workflow.mode !== "coarse_human_gated") return "none";
  if (repoPath) {
    const override = overrides[coarseOverrideKey(repoPath, workflow.id)];
    if (override) return override;
  }
  return workflow.coarsePrPreferenceDefault ?? DEFAULT_COARSE_PR_PREFERENCE;
}
