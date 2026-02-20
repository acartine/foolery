import { NextRequest, NextResponse } from "next/server";
import { showBead, updateBead, deleteBead } from "@/lib/bd";
import { updateBeadSchema } from "@/lib/schemas";
import { regroomAncestors } from "@/lib/regroom";
import { LABEL_TRANSITION_VERIFICATION } from "@/lib/verification-workflow";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const result = await showBead(id, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ data: result.data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = updateBeadSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Enforce edit lock: reject mutations when transition:verification is active
  const current = await showBead(id, repoPath);
  if (current.ok && current.data) {
    const labels = current.data.labels ?? [];
    if (labels.includes(LABEL_TRANSITION_VERIFICATION)) {
      return NextResponse.json(
        { error: "Bead is locked during auto-verification. Edits are disabled until verification completes." },
        { status: 409 }
      );
    }
  }

  const fields: Record<string, string | string[] | number | undefined> = {};
  for (const [key, val] of Object.entries(parsed.data)) {
    if (val !== undefined) {
      fields[key] = val as string | string[] | number;
    }
  }
  const result = await updateBead(id, fields, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Regroom ancestors when verification is removed (rejection may unblock parent close)
  const removedLabels = parsed.data.removeLabels;
  if (
    removedLabels &&
    Array.isArray(removedLabels) &&
    removedLabels.includes("stage:verification")
  ) {
    // Fire-and-forget: don't block the HTTP response on ancestor regroom
    regroomAncestors(id, repoPath).catch((err) =>
      console.error(`[regroom] background error for ${id}:`, err)
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;

  // Enforce edit lock: reject deletes when transition:verification is active
  const currentBead = await showBead(id, repoPath);
  if (currentBead.ok && currentBead.data) {
    const labels = currentBead.data.labels ?? [];
    if (labels.includes(LABEL_TRANSITION_VERIFICATION)) {
      return NextResponse.json(
        { error: "Bead is locked during auto-verification. Deletion is disabled until verification completes." },
        { status: 409 }
      );
    }
  }

  const result = await deleteBead(id, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
