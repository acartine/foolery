/**
 * Descriptive correction helpers for KnotsBackend.
 *
 * Extracted from knots-backend.ts to stay within the 500-line file limit.
 * `markTerminalImpl` is the authoritative entry point for skipping a beat
 * to a terminal state (e.g. "mark shipped", "abandon", "close") by way of
 * kno's idiomatic `force: true` flag. It validates that `targetState`
 * is actually a terminal of the beat's profile; misuse raises a
 * `WorkflowCorrectionFailureError` carrying the greppable marker
 * `FOOLERY WORKFLOW CORRECTION FAILURE`.
 */

import type { BackendResult } from "@/lib/backend-port";
import type {
  Beat,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import * as knots from "@/lib/knots";
import {
  fromKnots,
  propagateError,
} from "@/lib/backends/knots-backend-helpers";
import {
  WorkflowCorrectionFailureError,
  WorkflowRewindFailureError,
} from "@/lib/workflow-correction-failure";

/** Canonical target state used by `KnotsBackend.close`. */
export const KNOTS_CLOSE_TARGET_STATE = "shipped" as const;

export interface CorrectionLoaders {
  fetchBeat: (id: string, rp: string) => Promise<BackendResult<Beat>>;
  fetchWorkflows: (
    rp: string,
  ) => Promise<BackendResult<MemoryWorkflowDescriptor[]>>;
}

interface CorrectionContext {
  workflows: MemoryWorkflowDescriptor[];
  profileId: string | undefined;
  currentState: string;
}

async function loadCorrectionContext(
  id: string,
  repoPath: string,
  loaders: CorrectionLoaders,
): Promise<BackendResult<CorrectionContext>> {
  const currentResult = await loaders.fetchBeat(id, repoPath);
  if (!currentResult.ok || !currentResult.data) {
    return propagateError<CorrectionContext>(currentResult);
  }
  const workflowsResult = await loaders.fetchWorkflows(repoPath);
  if (!workflowsResult.ok) {
    return propagateError<CorrectionContext>(workflowsResult);
  }
  const current = currentResult.data;
  const rawKnoState =
    typeof current.metadata?.knotsState === "string"
      ? current.metadata.knotsState
      : current.state;
  return {
    ok: true,
    data: {
      workflows: workflowsResult.data ?? [],
      profileId: current.profileId ?? current.workflowId,
      currentState: rawKnoState,
    },
  };
}

function resolveProfile(
  workflows: MemoryWorkflowDescriptor[],
  profileId: string | undefined,
): MemoryWorkflowDescriptor | null {
  if (!profileId) return null;
  const normalized = profileId.trim().toLowerCase();
  return (
    workflows.find((wf) => wf.id === normalized)
    ?? workflows.find((wf) => wf.backingWorkflowId === normalized)
    ?? null
  );
}

/**
 * Apply a descriptive correction: force-transition `id` to a terminal
 * state via kno's idiomatic `force: true` update. Throws
 * `WorkflowCorrectionFailureError` on invalid target.
 */
export async function markTerminalImpl(
  id: string,
  targetState: string,
  reason: string | undefined,
  repoPath: string,
  workflows: MemoryWorkflowDescriptor[],
  currentProfileId: string | undefined,
): Promise<BackendResult<void>> {
  const normalizedTarget = targetState.trim().toLowerCase();
  const profile = resolveProfile(workflows, currentProfileId);

  if (!profile) {
    throw new WorkflowCorrectionFailureError({
      beatId: id,
      profileId: currentProfileId ?? "<unknown>",
      targetState: normalizedTarget,
      allowedTerminals: [],
      reason: "unknown_profile",
    });
  }

  const allowedTerminals = profile.terminalStates.map(
    (state) => state.trim().toLowerCase(),
  );
  if (!allowedTerminals.includes(normalizedTarget)) {
    throw new WorkflowCorrectionFailureError({
      beatId: id,
      profileId: profile.id,
      targetState: normalizedTarget,
      allowedTerminals,
      reason: "non_terminal_target",
    });
  }

  const result = fromKnots(
    await knots.updateKnot(
      id,
      {
        status: normalizedTarget,
        force: true,
        addNote: reason ? `Correction: ${reason}` : undefined,
      },
      repoPath,
    ),
  );
  if (!result.ok) {
    return propagateError<void>(result);
  }
  return { ok: true };
}

/**
 * Descriptive correction: reopen a terminal beat into its profile's
 * `retakeState` via kno's idiomatic `force: true`. Throws
 * `WorkflowCorrectionFailureError` when the profile cannot be resolved
 * or has no usable retake target.
 */
export async function reopenImpl(
  id: string,
  reason: string | undefined,
  repoPath: string,
  workflows: MemoryWorkflowDescriptor[],
  currentProfileId: string | undefined,
): Promise<BackendResult<void>> {
  const profile = resolveProfile(workflows, currentProfileId);
  if (!profile) {
    throw new WorkflowCorrectionFailureError({
      beatId: id,
      profileId: currentProfileId ?? "<unknown>",
      targetState: "<retake>",
      allowedTerminals: [],
      reason: "unknown_profile",
    });
  }
  const retakeState = profile.retakeState.trim().toLowerCase();
  const result = fromKnots(
    await knots.updateKnot(
      id,
      {
        status: retakeState,
        force: true,
        addNote: reason ? `Retake: ${reason}` : undefined,
      },
      repoPath,
    ),
  );
  if (!result.ok) {
    return propagateError<void>(result);
  }
  return { ok: true };
}

// ── Rewind (hackish fat-finger correction) ──────────────────────────
//
// `rewindImpl` walks a beat backward to an earlier queue state via
// kno's `force: true`. It is NOT a primary workflow action — it exists
// to recover beats that were over-shot forward (e.g. fat-fingered all
// the way to Shipped) or orphaned in an action state with no legal
// kno transition home. Use the generic update() path for any
// kno-sanctioned forward transition; use `markTerminal` to skip to
// terminal; use `reopen` for the curated ReTake regression flow.
//
// Validation is deliberately strict so this primitive cannot quietly
// stand in for a normal state change: target must be a queue state of
// the profile (per the loom-derived `queueStates` field — never a
// hardcoded name list or prefix) AND strictly earlier than the current
// state. Any misuse throws `WorkflowRewindFailureError` and emits the
// loud `FOOLERY WORKFLOW CORRECTION FAILURE` banner.

function normalizeList(list: ReadonlyArray<string> | undefined): string[] {
  return (list ?? []).map((s) => s.trim().toLowerCase());
}

function earlierQueueStates(
  states: ReadonlyArray<string>,
  queueStates: ReadonlySet<string>,
  currentIndex: number,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < currentIndex; i++) {
    const s = states[i];
    if (s && queueStates.has(s)) out.push(s);
  }
  return out;
}

export async function rewindImpl(
  id: string,
  targetState: string,
  reason: string | undefined,
  repoPath: string,
  workflows: MemoryWorkflowDescriptor[],
  currentProfileId: string | undefined,
  currentState: string,
): Promise<BackendResult<void>> {
  const normalizedTarget = targetState.trim().toLowerCase();
  const normalizedCurrent = currentState.trim().toLowerCase();
  const profile = resolveProfile(workflows, currentProfileId);

  if (!profile) {
    throw new WorkflowRewindFailureError({
      beatId: id,
      profileId: currentProfileId ?? "<unknown>",
      currentState: normalizedCurrent,
      targetState: normalizedTarget,
      allowedRewindTargets: [],
      reason: "unknown_profile",
    });
  }

  const states = normalizeList(profile.states);
  const queueStateSet = new Set(normalizeList(profile.queueStates));
  const terminalSet = new Set(normalizeList(profile.terminalStates));
  const currentIndex = states.indexOf(normalizedCurrent);
  const allowedRewindTargets = currentIndex >= 0
    ? earlierQueueStates(states, queueStateSet, currentIndex)
    : Array.from(queueStateSet);

  if (
    !queueStateSet.has(normalizedTarget)
    || !states.includes(normalizedTarget)
    || terminalSet.has(normalizedTarget)
  ) {
    throw new WorkflowRewindFailureError({
      beatId: id,
      profileId: profile.id,
      currentState: normalizedCurrent,
      targetState: normalizedTarget,
      allowedRewindTargets,
      reason: "non_queue_target",
    });
  }

  const targetIndex = states.indexOf(normalizedTarget);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= currentIndex) {
    throw new WorkflowRewindFailureError({
      beatId: id,
      profileId: profile.id,
      currentState: normalizedCurrent,
      targetState: normalizedTarget,
      allowedRewindTargets,
      reason: "not_earlier_than_current",
    });
  }

  const result = fromKnots(
    await knots.updateKnot(
      id,
      {
        status: normalizedTarget,
        force: true,
        addNote: reason
          ? `Rewind correction: ${reason}`
          : "Rewind correction (fat-finger recovery)",
      },
      repoPath,
    ),
  );
  if (!result.ok) {
    return propagateError<void>(result);
  }
  return { ok: true };
}

/** Load context and dispatch `rewindImpl`. */
export async function rewindWithLoaders(
  id: string,
  targetState: string,
  reason: string | undefined,
  repoPath: string,
  loaders: CorrectionLoaders,
): Promise<BackendResult<void>> {
  const ctx = await loadCorrectionContext(id, repoPath, loaders);
  if (!ctx.ok || !ctx.data) return propagateError<void>(ctx);
  return rewindImpl(
    id, targetState, reason, repoPath,
    ctx.data.workflows, ctx.data.profileId, ctx.data.currentState,
  );
}

/** Load context and dispatch `markTerminalImpl`. */
export async function markTerminalWithLoaders(
  id: string,
  targetState: string,
  reason: string | undefined,
  repoPath: string,
  loaders: CorrectionLoaders,
): Promise<BackendResult<void>> {
  const ctx = await loadCorrectionContext(id, repoPath, loaders);
  if (!ctx.ok || !ctx.data) return propagateError<void>(ctx);
  return markTerminalImpl(
    id, targetState, reason, repoPath,
    ctx.data.workflows, ctx.data.profileId,
  );
}

/** Load context and dispatch `reopenImpl`. */
export async function reopenWithLoaders(
  id: string,
  reason: string | undefined,
  repoPath: string,
  loaders: CorrectionLoaders,
): Promise<BackendResult<void>> {
  const ctx = await loadCorrectionContext(id, repoPath, loaders);
  if (!ctx.ok || !ctx.data) return propagateError<void>(ctx);
  return reopenImpl(
    id, reason, repoPath,
    ctx.data.workflows, ctx.data.profileId,
  );
}
