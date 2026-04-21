/**
 * Descriptive correction helpers for BeadsBackend.
 *
 * Extracted from beads-backend.ts to keep it within the 500-line budget.
 * These helpers mutate the in-memory `Beat` passed in; callers are
 * responsible for flushing the change store back to disk.
 */

import type { Beat } from "@/lib/types";
import {
  builtinProfileDescriptor,
  deriveWorkflowRuntimeState,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "@/lib/workflows";
import {
  WorkflowCorrectionFailureError,
} from "@/lib/workflow-correction-failure";

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Pick the default `markTerminal` target for a beat's profile. Prefers
 * `shipped`, then the first terminal, then the literal string `"shipped"`
 * if the profile unexpectedly lacks terminals.
 */
export function chooseCloseTarget(beat: Beat): string {
  const workflow = builtinProfileDescriptor(
    beat.profileId ?? beat.workflowId,
  );
  return (
    workflow.terminalStates.find((s) => s === "shipped")
    ?? workflow.terminalStates[0]
    ?? "shipped"
  );
}

/**
 * Apply `markTerminal` semantics to an in-memory `Beat`. Throws
 * `WorkflowCorrectionFailureError` if `targetState` is not a terminal
 * of the beat's profile.
 */
export function applyMarkTerminal(
  beat: Beat,
  targetState: string,
  reason: string | undefined,
): void {
  const workflow = builtinProfileDescriptor(
    beat.profileId ?? beat.workflowId,
  );
  const normalizedTarget = targetState.trim().toLowerCase();
  const allowedTerminals = workflow.terminalStates.map(
    (state) => state.trim().toLowerCase(),
  );
  if (!allowedTerminals.includes(normalizedTarget)) {
    throw new WorkflowCorrectionFailureError({
      beatId: beat.id,
      profileId: workflow.id,
      targetState: normalizedTarget,
      allowedTerminals,
      reason: "non_terminal_target",
    });
  }
  const runtime = deriveWorkflowRuntimeState(workflow, normalizedTarget);
  beat.state = runtime.state;
  beat.nextActionState = runtime.nextActionState;
  beat.nextActionOwnerKind = runtime.nextActionOwnerKind;
  beat.requiresHumanAction = runtime.requiresHumanAction;
  beat.isAgentClaimable = runtime.isAgentClaimable;
  beat.labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(beat.labels ?? [], runtime.state),
    workflow.id,
  );
  beat.closed = isoNow();
  beat.updated = isoNow();
  if (reason) {
    beat.metadata = { ...beat.metadata, close_reason: reason };
  }
}

/**
 * Apply `reopen` semantics to an in-memory `Beat`: force state back to
 * the profile's `retakeState`.
 */
export function applyReopen(
  beat: Beat,
  reason: string | undefined,
): void {
  const workflow = builtinProfileDescriptor(
    beat.profileId ?? beat.workflowId,
  );
  const runtime = deriveWorkflowRuntimeState(workflow, workflow.retakeState);
  beat.state = runtime.state;
  beat.nextActionState = runtime.nextActionState;
  beat.nextActionOwnerKind = runtime.nextActionOwnerKind;
  beat.requiresHumanAction = runtime.requiresHumanAction;
  beat.isAgentClaimable = runtime.isAgentClaimable;
  beat.labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(beat.labels ?? [], runtime.state),
    workflow.id,
  );
  beat.closed = undefined;
  beat.updated = isoNow();
  if (reason) {
    beat.metadata = { ...beat.metadata, retake_reason: reason };
  }
}
