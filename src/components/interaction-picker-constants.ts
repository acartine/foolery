/**
 * Workflow-step filter options for the interaction picker.
 *
 * Derived from the loom-sourced `MemoryWorkflowDescriptor.queueActions`
 * map across all builtin workflow descriptors — never hardcoded. Each
 * step filter pairs a queue state with the action state it transitions
 * into (e.g. `ready_for_planning` → `planning`). Adding or renaming
 * states in a `.loom` profile flows through automatically; nothing in
 * this module needs to know specific state names.
 *
 * See CLAUDE.md §"State Classification Is Loom-Derived".
 */

import {
  builtinWorkflowDescriptors,
  compareWorkflowStatePriority,
} from "@/lib/workflows";

export type WorkflowStepFilterId = string;

export interface WorkflowStepFilterOption {
  id: WorkflowStepFilterId;
  label: string;
  states: readonly [string, string];
}

function formatStepLabel(actionState: string): string {
  return actionState
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildStepFilters(): WorkflowStepFilterOption[] {
  const seen = new Set<string>();
  const out: WorkflowStepFilterOption[] = [];
  for (const workflow of builtinWorkflowDescriptors()) {
    const queueActions = workflow.queueActions ?? {};
    const queueOrder = workflow.queueStates ?? Object.keys(queueActions);
    for (const queueState of queueOrder) {
      const actionState = queueActions[queueState];
      if (!actionState) continue;
      if (seen.has(actionState)) continue;
      seen.add(actionState);
      out.push({
        id: actionState,
        label: formatStepLabel(actionState),
        states: [queueState, actionState],
      });
    }
  }
  out.sort((a, b) =>
    compareWorkflowStatePriority(a.states[0], b.states[0]),
  );
  return out;
}

export const WORKFLOW_STEP_FILTERS: readonly WorkflowStepFilterOption[] =
  buildStepFilters();

export const WORKFLOW_FILTER_BY_ID = new Map<
  WorkflowStepFilterId,
  WorkflowStepFilterOption
>(WORKFLOW_STEP_FILTERS.map((item) => [item.id, item]));

export const WORKFLOW_STATES = Array.from(
  new Set(
    WORKFLOW_STEP_FILTERS.flatMap((item) => [item.states[0], item.states[1]]),
  ),
);

export const WORKFLOW_FILTER_BY_STATE = new Map<string, WorkflowStepFilterOption>(
  WORKFLOW_STEP_FILTERS.flatMap((item) => [
    [item.states[0], item] as const,
    [item.states[1], item] as const,
  ]),
);
