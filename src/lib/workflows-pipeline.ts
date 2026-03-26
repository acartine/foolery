/**
 * Pipeline ordering, transition helpers, and workflow lookup.
 *
 * Extracted from workflows-runtime.ts to stay under 500 lines.
 */
import type { MemoryWorkflowDescriptor } from "@/lib/types";
import {
  LEGACY_BEADS_COARSE_WORKFLOW_ID,
  normalizeProfileId,
} from "@/lib/workflows";

/**
 * Ordered pipeline index for each workflow state.
 * A transition is a "rollback" when the target has a lower
 * index than the source.
 */
const STATE_PIPELINE_ORDER: ReadonlyMap<string, number> =
  new Map([
    ["ready_for_planning", 0],
    ["planning", 1],
    ["ready_for_plan_review", 2],
    ["plan_review", 3],
    ["ready_for_implementation", 4],
    ["implementation", 5],
    ["ready_for_implementation_review", 6],
    ["implementation_review", 7],
    ["ready_for_shipment", 8],
    ["shipment", 9],
    ["ready_for_shipment_review", 10],
    ["shipment_review", 11],
    ["shipped", 12],
  ]);

/** Compare two workflow states by pipeline priority. */
export function compareWorkflowStatePriority(
  left: string,
  right: string,
): number {
  const leftIndex = STATE_PIPELINE_ORDER.get(left);
  const rightIndex = STATE_PIPELINE_ORDER.get(right);

  if (leftIndex !== undefined && rightIndex !== undefined) {
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  }

  if (leftIndex !== undefined) return -1;
  if (rightIndex !== undefined) return 1;
  return left.localeCompare(right);
}

/** Returns true when the transition moves backward. */
export function isRollbackTransition(
  from: string,
  to: string,
): boolean {
  const fromIndex = STATE_PIPELINE_ORDER.get(from);
  const toIndex = STATE_PIPELINE_ORDER.get(to);
  if (fromIndex === undefined || toIndex === undefined) {
    return false;
  }
  return toIndex < fromIndex;
}

/**
 * Return the single forward (non-rollback) transition target
 * for a given state.
 */
export function forwardTransitionTarget(
  currentState: string,
  workflow: MemoryWorkflowDescriptor,
): string | null {
  const transitions = workflow.transitions;
  if (!transitions) return null;

  for (const { from, to } of transitions) {
    if (from !== currentState) continue;
    if (isRollbackTransition(from, to)) continue;
    return to;
  }

  return null;
}

// ── Workflow descriptor lookup ────────────────────────────────

export function workflowDescriptorById(
  workflows: MemoryWorkflowDescriptor[],
): Map<string, MemoryWorkflowDescriptor> {
  const map = new Map<string, MemoryWorkflowDescriptor>();
  for (const workflow of workflows) {
    map.set(workflow.id, workflow);
    map.set(workflow.backingWorkflowId, workflow);
    if (workflow.profileId) {
      map.set(workflow.profileId, workflow);
    }
  }

  const autopilot = workflows.find(
    (w) => w.id === "autopilot",
  );
  if (autopilot) {
    map.set(LEGACY_BEADS_COARSE_WORKFLOW_ID, autopilot);
    map.set("knots-granular", autopilot);
    map.set("knots-granular-autonomous", autopilot);
  }

  const semiauto = workflows.find((w) => w.id === "semiauto");
  if (semiauto) {
    map.set("knots-coarse", semiauto);
    map.set("knots-coarse-human-gated", semiauto);
    map.set("beads-coarse-human-gated", semiauto);
  }

  return map;
}

export function resolveWorkflowForBeat(
  beat: { profileId?: string; workflowId?: string },
  workflowsById: Map<string, MemoryWorkflowDescriptor>,
): MemoryWorkflowDescriptor | null {
  const profileId = normalizeProfileId(beat.profileId);
  if (profileId && workflowsById.has(profileId)) {
    return workflowsById.get(profileId)!;
  }
  if (beat.workflowId && workflowsById.has(beat.workflowId)) {
    return workflowsById.get(beat.workflowId)!;
  }
  return null;
}

// ── Inference helpers ────────────────────────────────────────

export function inferFinalCutState(
  states: string[],
): string | null {
  const preferred = [
    "ready_for_plan_review",
    "ready_for_implementation_review",
    "ready_for_shipment_review",
    "reviewing",
  ];
  for (const candidate of preferred) {
    if (states.includes(candidate)) return candidate;
  }
  return null;
}

export function inferRetakeState(
  states: string[],
  initialState: string,
): string {
  const preferred = [
    "ready_for_implementation",
    "retake",
    "retry",
    "rejected",
    "refining",
  ];
  for (const candidate of preferred) {
    if (states.includes(candidate)) return candidate;
  }
  return initialState;
}
