import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import {
  backendErrorStatus,
  withDispatchFailureHandling,
} from "@/lib/backend-http";
import { markTerminalSchema } from "@/lib/schemas";
import { regroomAncestors } from "@/lib/regroom";
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
  const parsed = markTerminalSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  return withDispatchFailureHandling(async () => {
    const backend = getBackend();
    const current = await backend.get(id, repoPath);
    const canonicalId =
      current.ok && current.data ? current.data.id : id;

    try {
      const result = await backend.markTerminal(
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
      if (err instanceof WorkflowCorrectionFailureError) {
        return NextResponse.json(
          { error: err.message },
          { status: 400 },
        );
      }
      throw err;
    }

    await regroomAncestors(canonicalId, repoPath);

    return NextResponse.json({ ok: true });
  });
}
