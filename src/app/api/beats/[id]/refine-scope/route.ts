import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import {
  enqueueBeatScopeRefinement,
} from "@/lib/scope-refinement-worker";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const repoPath: string | undefined = body._repo;

  const backend = getBackend();
  const current = await backend.get(id, repoPath);
  const canonicalId =
    current.ok && current.data
      ? current.data.id
      : id;

  const job =
    await enqueueBeatScopeRefinement(
      canonicalId,
      repoPath,
    );

  if (!job) {
    return NextResponse.json(
      {
        error:
          "Scope refinement agent not configured",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { jobId: job.id, beatId: canonicalId },
  });
}
