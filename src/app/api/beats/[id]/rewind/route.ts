/**
 * POST /api/beats/[id]/rewind
 *
 * HACKISH FAT-FINGER CORRECTION — not a primary workflow action.
 *
 * Walks a beat backward to an earlier queue state (per the loom-
 * derived `descriptor.queueStates`) via kno's `force: true`. Use only
 * to recover beats that were over-shot
 * forward (e.g. accidentally Shipped) or orphaned in an action state
 * with no legal kno transition home. For normal forward moves, hit
 * `PATCH /api/beats/[id]` (the workflow engine validates). For
 * terminal corrections use `/mark-terminal`. For curated regression
 * reopens use `/reopen`.
 *
 * Server enforces (via the backend): target must be a queue state of
 * the profile, must NOT be terminal, and must be strictly earlier
 * than the current state. Misuse returns 400 with a
 * `FOOLERY WORKFLOW CORRECTION FAILURE` red banner in server logs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import { rewindSchema } from "@/lib/schemas";
import {
  WorkflowRewindFailureError,
} from "@/lib/workflow-correction-failure";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const backend = getBackend();
  const parsed = rewindSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const current = await backend.get(id, repoPath);
  const canonicalId =
    current.ok && current.data ? current.data.id : id;

  try {
    const result = await backend.rewind(
      canonicalId,
      parsed.data.targetState,
      parsed.data.reason,
      repoPath,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error?.message },
        { status: backendErrorStatus(result.error) },
      );
    }
  } catch (err) {
    if (err instanceof WorkflowRewindFailureError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
