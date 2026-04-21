/**
 * Update-method logic for KnotsBackend.  Extracted from
 * knots-backend.ts to keep the class file within the 500-line limit.
 */

import type { BackendResult } from "@/lib/backend-port";
import type {
  CreateBeatInput,
  UpdateBeatInput,
} from "@/lib/schemas";
import type {
  Beat,
  MemoryWorkflowDescriptor,
} from "@/lib/types";
import type { KnotUpdateInput } from "@/lib/knots";
import * as knots from "@/lib/knots";
import { normalizeStateForWorkflow } from "@/lib/workflows";

import {
  ok,
  fromKnots,
  propagateError,
  backendError,
  serializeInvariants,
} from "@/lib/backends/knots-backend-helpers";

// ── Profile switching ───────────────────────────────────────────────

export async function applyProfileChange(
  id: string,
  rp: string,
  current: Beat,
  input: UpdateBeatInput,
  workflows: MemoryWorkflowDescriptor[],
): Promise<{
  ok: true;
  workflow: MemoryWorkflowDescriptor;
  stateHandledByProfileSet: boolean;
} | BackendResult<void>> {
  const currentProfileId = current.profileId ?? current.workflowId;
  let workflow =
    workflows.find((item) => item.id === currentProfileId) ??
    workflows[0];
  const requestedProfileId = input.profileId?.trim();
  let stateHandledByProfileSet = false;

  if (requestedProfileId) {
    const targetWorkflow = workflows.find(
      (item) => item.id === requestedProfileId
    );
    if (!targetWorkflow) {
      return backendError(
        "INVALID_INPUT",
        `Unknown profile "${requestedProfileId}" for knots backend`,
      );
    }

    if (requestedProfileId !== currentProfileId) {
      const rawKnoState =
        typeof current.metadata?.knotsState === "string"
          ? current.metadata.knotsState.trim().toLowerCase()
          : undefined;
      const currentWorkflowState = rawKnoState ?? current.state;
      const requestedState =
        input.state !== undefined
          ? normalizeStateForWorkflow(
              input.state,
              targetWorkflow,
            )
          : normalizeStateForWorkflow(
              currentWorkflowState,
              targetWorkflow,
            );
      const knotsProfileEtag =
        typeof current.metadata?.knotsProfileEtag === "string"
          ? current.metadata.knotsProfileEtag.trim()
          : undefined;
      const ifMatch =
        knotsProfileEtag && knotsProfileEtag.length > 0
          ? knotsProfileEtag
          : undefined;
      const profileResult = fromKnots(
        await knots.setKnotProfile(id, targetWorkflow.id, rp, {
          state: requestedState,
          ifMatch,
        }),
      );
      if (!profileResult.ok) {
        return propagateError<void>(profileResult);
      }
      stateHandledByProfileSet = true;
    }

    workflow = targetWorkflow;
  }

  return { ok: true, workflow, stateHandledByProfileSet };
}

// ── Patch building ──────────────────────────────────────────────────

export function buildUpdatePatch(
  current: Beat,
  input: UpdateBeatInput,
  workflow: MemoryWorkflowDescriptor | undefined,
  stateHandledByProfileSet: boolean,
): KnotUpdateInput {
  const patch: KnotUpdateInput = {};

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) {
    patch.description = input.description;
  }
  if (input.acceptance !== undefined) {
    patch.acceptance = input.acceptance;
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority;
  }

  if (input.state !== undefined && !stateHandledByProfileSet) {
    applyStateToPatch(patch, current, input, workflow);
  }

  if (input.type !== undefined) patch.type = input.type;
  if (input.labels?.length) patch.addTags = input.labels;
  if (input.removeLabels?.length) {
    patch.removeTags = input.removeLabels;
  }
  if (input.notes !== undefined) patch.addNote = input.notes;
  patch.addInvariants = serializeInvariants(input.addInvariants);
  patch.removeInvariants = serializeInvariants(
    input.removeInvariants,
  );
  if (input.clearInvariants) patch.clearInvariants = true;

  return patch;
}

function applyStateToPatch(
  patch: KnotUpdateInput,
  current: Beat,
  input: UpdateBeatInput,
  workflow: MemoryWorkflowDescriptor | undefined,
) {
  const normalizedState = workflow
    ? normalizeStateForWorkflow(input.state!, workflow)
    : input.state!.trim().toLowerCase();
  const normalizedDisplayState = workflow
    ? normalizeStateForWorkflow(current.state, workflow)
    : current.state.trim().toLowerCase();

  const rawKnoState =
    typeof current.metadata?.knotsState === "string"
      ? current.metadata.knotsState.trim().toLowerCase()
      : undefined;
  const transitionSourceState =
    rawKnoState ?? normalizedDisplayState;

  if (normalizedState === transitionSourceState) {
    // Already in this state -- skip to avoid "no field change" error.
    return;
  }

  // Generic update passes `status` through to kno with NO force flag.
  // kno validates the transition against the authoritative .loom profile.
  // Skip-to-terminal corrections must use the descriptive `markTerminal`
  // path on the backend rather than a generic state update.
  patch.status = normalizedState;
}

export function hasPatchFields(patch: KnotUpdateInput): boolean {
  return (
    patch.title !== undefined ||
    patch.description !== undefined ||
    patch.acceptance !== undefined ||
    patch.priority !== undefined ||
    patch.status !== undefined ||
    patch.type !== undefined ||
    (patch.addTags?.length ?? 0) > 0 ||
    (patch.removeTags?.length ?? 0) > 0 ||
    patch.addNote !== undefined ||
    (patch.addInvariants?.length ?? 0) > 0 ||
    (patch.removeInvariants?.length ?? 0) > 0 ||
    patch.clearInvariants === true
  );
}

// ── Parent edge management ──────────────────────────────────────────

export async function updateParentEdges(
  id: string,
  nextParentRaw: string,
  rp: string,
  invalidateEdgeCache: (rp: string, id?: string) => void,
): Promise<BackendResult<void> | null> {
  const incoming = fromKnots(
    await knots.listEdges(id, "incoming", rp),
  );
  if (!incoming.ok) return propagateError<void>(incoming);

  const existingParents = (incoming.data ?? [])
    .filter(
      (edge) => edge.kind === "parent_of" && edge.dst === id,
    )
    .map((edge) => edge.src);

  const nextParent = nextParentRaw.trim();

  for (const parentId of existingParents) {
    if (nextParent && parentId === nextParent) continue;
    const removeResult = fromKnots(
      await knots.removeEdge(parentId, "parent_of", id, rp),
    );
    if (!removeResult.ok) {
      return propagateError<void>(removeResult);
    }
    invalidateEdgeCache(rp, parentId);
  }

  if (nextParent && !existingParents.includes(nextParent)) {
    const addResult = fromKnots(
      await knots.addEdge(nextParent, "parent_of", id, rp),
    );
    if (!addResult.ok) return propagateError<void>(addResult);
    invalidateEdgeCache(rp, nextParent);
  }

  invalidateEdgeCache(rp, id);
  return null;
}

// ── Create helper ───────────────────────────────────────────────────

export async function createKnotImpl(
  input: CreateBeatInput,
  rp: string,
  selectedWorkflow: MemoryWorkflowDescriptor,
  invalidateEdgeCache: (rp: string, id?: string) => void,
): Promise<BackendResult<{ id: string }>> {
  const createResult = fromKnots(
    await knots.newKnot(
      input.title,
      {
        description: input.description,
        acceptance: input.acceptance,
        state: selectedWorkflow.initialState,
        profile: selectedWorkflow.id,
      },
      rp,
    ),
  );
  if (!createResult.ok) {
    return propagateError<{ id: string }>(createResult);
  }

  const id = createResult.data!.id;

  const patch: KnotUpdateInput = {};
  if (input.priority !== undefined) {
    patch.priority = input.priority;
  }
  if (input.type) patch.type = input.type;
  if (input.labels?.length) patch.addTags = input.labels;
  if (input.notes) patch.addNote = input.notes;
  patch.addInvariants = serializeInvariants(
    input.invariants,
  );

  const hasPatch =
    patch.priority !== undefined ||
    patch.type !== undefined ||
    (patch.addTags?.length ?? 0) > 0 ||
    patch.addNote !== undefined ||
    (patch.addInvariants?.length ?? 0) > 0;

  if (hasPatch) {
    const updateResult = fromKnots(
      await knots.updateKnot(id, patch, rp),
    );
    if (!updateResult.ok) {
      return propagateError<{ id: string }>(updateResult);
    }
  }

  if (input.parent) {
    const parentResult = fromKnots(
      await knots.addEdge(
        input.parent,
        "parent_of",
        id,
        rp,
      ),
    );
    if (!parentResult.ok) {
      return propagateError<{ id: string }>(parentResult);
    }
    invalidateEdgeCache(rp, input.parent);
    invalidateEdgeCache(rp, id);
  }

  return ok({ id });
}
