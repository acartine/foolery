import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import { closeBeatSchema } from "@/lib/schemas";
import {
  WorkflowCorrectionFailureError,
} from "@/lib/workflow-correction-failure";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const backend = getBackend();
  const parsed = closeBeatSchema.safeParse(rest);
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
    const result = await backend.reopen(
      canonicalId,
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
    if (err instanceof WorkflowCorrectionFailureError) {
      return NextResponse.json(
        { error: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
