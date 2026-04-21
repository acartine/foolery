/**
 * Workflow step navigation helpers — descriptor-driven, no hardcoded state map.
 *
 * Every function here operates on `MemoryWorkflowDescriptor` and walks the
 * descriptor's `states`, `transitions`, `queueStates`, `actionStates`, and
 * `queueActions`. There are no SDLC state-name literals in this module.
 *
 * Extracted from workflows.ts so both stay under the 500-line budget.
 */

import type {
  MemoryWorkflowDescriptor,
  MemoryWorkflowOwners,
} from "@/lib/types";
import { StepPhase } from "@/lib/workflows";

/**
 * Classify a workflow state by consulting the workflow descriptor.
 *
 * Returns `{step, phase}` where `step` is the action-state name the beat will
 * transition into (queued) or IS currently in (active). Returns `null` for
 * terminal, deferred, or unknown states.
 *
 * Every workflow — SDLC, gate, explore, custom — uses this exact same lookup.
 * There is no hardcoded state map; the descriptor IS the source of truth.
 */
export function resolveStep(
  state: string,
  workflow: MemoryWorkflowDescriptor,
): { step: string; phase: StepPhase } | null {
  const actionStates = workflow.actionStates ?? [];
  if (actionStates.includes(state)) {
    return { step: state, phase: StepPhase.Active };
  }
  const queueStates = workflow.queueStates ?? [];
  if (queueStates.includes(state)) {
    const next = workflow.queueActions?.[state];
    if (!next) return null;
    return { step: next, phase: StepPhase.Queued };
  }
  return null;
}

/** Returns the queue state that leads to the given action state, or null. */
export function queueStateForStep(
  step: string,
  workflow: MemoryWorkflowDescriptor,
): string | null {
  const queueActions = workflow.queueActions ?? {};
  for (const [queueState, actionState] of Object.entries(queueActions)) {
    if (actionState === step) return queueState;
  }
  return null;
}

/**
 * Returns the action states of a workflow in their natural ordering,
 * derived from the transitions graph starting at `initialState`.
 */
function orderedActionStates(
  workflow: MemoryWorkflowDescriptor,
): string[] {
  const actionSet = new Set(workflow.actionStates ?? []);
  if (actionSet.size === 0) return [];
  const transitions = workflow.transitions ?? [];
  const successor = new Map<string, string>();
  for (const t of transitions) {
    if (t.from === "*") continue;
    if (!successor.has(t.from)) successor.set(t.from, t.to);
  }
  const visited = new Set<string>();
  const ordered: string[] = [];
  let cursor: string | undefined = workflow.initialState;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (actionSet.has(cursor)) ordered.push(cursor);
    cursor = successor.get(cursor);
  }
  for (const action of workflow.actionStates ?? []) {
    if (!ordered.includes(action)) ordered.push(action);
  }
  return ordered;
}

/** Queue state after the given action step completes, or null at the tail. */
export function nextQueueStateForStep(
  step: string,
  workflow: MemoryWorkflowDescriptor,
): string | null {
  const order = orderedActionStates(workflow);
  const idx = order.indexOf(step);
  if (idx < 0 || idx >= order.length - 1) return null;
  return queueStateForStep(order[idx + 1]!, workflow);
}

/** Queue state leading into the step before the given step, or null at head. */
export function priorQueueStateForStep(
  step: string,
  workflow: MemoryWorkflowDescriptor,
): string | null {
  const order = orderedActionStates(workflow);
  const idx = order.indexOf(step);
  if (idx <= 0) return null;
  return queueStateForStep(order[idx - 1]!, workflow);
}

/** True if the given action step is a review action (gated by a review queue). */
export function isReviewStep(
  step: string,
  workflow: MemoryWorkflowDescriptor,
): boolean {
  const reviewQueues = new Set(workflow.reviewQueueStates ?? []);
  const queue = queueStateForStep(step, workflow);
  return queue ? reviewQueues.has(queue) : false;
}

/** Returns the action step whose completion feeds into the given review step. */
export function priorActionStep(
  step: string,
  workflow: MemoryWorkflowDescriptor,
): string | null {
  if (!isReviewStep(step, workflow)) return null;
  const reviewQueue = queueStateForStep(step, workflow);
  if (!reviewQueue) return null;
  const transitions = workflow.transitions ?? [];
  const actionSet = new Set(workflow.actionStates ?? []);
  for (const t of transitions) {
    if (t.to === reviewQueue && actionSet.has(t.from)) return t.from;
  }
  return null;
}

/**
 * Derive queue/action structure from a workflow's raw states, transitions,
 * and per-action owners map — without consulting any hardcoded state→phase
 * map.
 *
 * - An action state is any state that appears as a key in `owners`.
 * - A queue state is any non-action, non-terminal state.
 * - queueActions[q] = the action state `q` transitions into, when exactly one
 *   forward transition from `q` lands on an action state.
 */
export function deriveWorkflowStructure(input: {
  states: ReadonlyArray<string>;
  transitions: ReadonlyArray<{ from: string; to: string }>;
  owners: MemoryWorkflowOwners;
  terminalStates: ReadonlyArray<string>;
}): {
  queueStates: string[];
  actionStates: string[];
  queueActions: Record<string, string>;
} {
  const actionStateSet = new Set(Object.keys(input.owners));
  const terminalSet = new Set(input.terminalStates);
  const actionStates = input.states.filter((s) => actionStateSet.has(s));
  const queueStates = input.states.filter(
    (s) => !actionStateSet.has(s) && !terminalSet.has(s),
  );
  const queueActions: Record<string, string> = {};
  for (const q of queueStates) {
    const forward = input.transitions.filter(
      (t) => t.from === q && actionStateSet.has(t.to),
    );
    if (forward.length === 1) queueActions[q] = forward[0]!.to;
  }
  return { queueStates, actionStates, queueActions };
}
