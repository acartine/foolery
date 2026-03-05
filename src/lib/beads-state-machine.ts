/**
 * Beads state machine module.
 *
 * Provides `nextBeat()` and `claimBeat()` for advancing beats through
 * their workflow lifecycle via the backend port.
 */

import { getBackend } from "@/lib/backend-instance";
import type { Beat, MemoryWorkflowDescriptor } from "@/lib/types";
import {
  builtinProfileDescriptor,
  deriveWorkflowRuntimeState,
  forwardTransitionTarget,
  StepPhase,
  resolveStep,
} from "@/lib/workflows";

// ── Error helpers ──────────────────────────────────────────────

function stateMismatchError(beatId: string, expectedState: string, currentState: string): Error {
  return new Error(
    `Beat ${beatId}: expected state '${expectedState}' but currently '${currentState}'`,
  );
}

// ── Workflow resolution ────────────────────────────────────────

function resolveWorkflow(beat: Beat): MemoryWorkflowDescriptor {
  return builtinProfileDescriptor(beat.profileId ?? beat.workflowId);
}

// ── nextBeat ───────────────────────────────────────────────────

/**
 * Advance a beat to its next forward state in the workflow.
 *
 * Loads the beat via backend, verifies its current state matches
 * `expectedState`, computes the forward transition target, and
 * persists the update through `getBackend().update()`.
 *
 * Throws when:
 * - The beat cannot be loaded.
 * - The current state does not match `expectedState`.
 * - No forward transition exists from the current state.
 * - The backend update fails.
 */
export async function nextBeat(
  beatId: string,
  expectedState: string,
  repoPath?: string,
): Promise<{ beat: Beat; nextState: string }> {
  const backend = getBackend();
  const getResult = await backend.get(beatId, repoPath);
  if (!getResult.ok || !getResult.data) {
    throw new Error(`Failed to load beat ${beatId}: ${getResult.error?.message ?? "not found"}`);
  }

  const beat = getResult.data;
  if (beat.state !== expectedState) {
    throw stateMismatchError(beatId, expectedState, beat.state);
  }

  const workflow = resolveWorkflow(beat);
  const target = forwardTransitionTarget(beat.state, workflow);
  if (!target) {
    throw new Error(`No forward transition from state '${beat.state}' for beat ${beatId}`);
  }

  const updateResult = await backend.update(beatId, { state: target }, repoPath);
  if (!updateResult.ok) {
    throw new Error(`Failed to update beat ${beatId}: ${updateResult.error?.message ?? "unknown"}`);
  }

  return { beat, nextState: target };
}

// ── claimBeat ──────────────────────────────────────────────────

/**
 * Claim a beat by transitioning it from a queued state to its
 * corresponding active state.
 *
 * Verifies that the beat is in a queued phase and is agent-claimable
 * before performing the transition.
 *
 * Throws when:
 * - The beat cannot be loaded.
 * - The beat is not in a queued state.
 * - The beat is not agent-claimable (e.g. human-owned step).
 * - The backend update fails.
 */
export async function claimBeat(
  beatId: string,
  repoPath?: string,
): Promise<{ beat: Beat; nextState: string }> {
  const backend = getBackend();
  const getResult = await backend.get(beatId, repoPath);
  if (!getResult.ok || !getResult.data) {
    throw new Error(`Failed to load beat ${beatId}: ${getResult.error?.message ?? "not found"}`);
  }

  const beat = getResult.data;
  const resolved = resolveStep(beat.state);

  if (!resolved || resolved.phase !== StepPhase.Queued) {
    throw stateMismatchError(beatId, "queued", beat.state);
  }

  const workflow = resolveWorkflow(beat);
  const runtime = deriveWorkflowRuntimeState(workflow, beat.state);

  if (!runtime.isAgentClaimable) {
    throw new Error(
      `Beat ${beatId}: expected state 'agent-claimable' but currently '${beat.state}' is not claimable`,
    );
  }

  const target = forwardTransitionTarget(beat.state, workflow);
  if (!target) {
    throw new Error(`No forward transition from state '${beat.state}' for beat ${beatId}`);
  }

  const updateResult = await backend.update(beatId, { state: target }, repoPath);
  if (!updateResult.ok) {
    throw new Error(`Failed to update beat ${beatId}: ${updateResult.error?.message ?? "unknown"}`);
  }

  return { beat, nextState: target };
}
