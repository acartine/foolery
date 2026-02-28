import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import { closeBeadSchema } from "@/lib/schemas";
import { regroomAncestors } from "@/lib/regroom";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const backend = getBackend();
  const parsed = closeBeadSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const current = await backend.get(id, repoPath);
  const canonicalId = current.ok && current.data ? current.data.id : id;
  const result = await backend.close(canonicalId, parsed.data.reason, repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message },
      { status: backendErrorStatus(result.error) },
    );
  }

  // Auto-close ancestors whose children are all closed
  await regroomAncestors(canonicalId, repoPath);

  return NextResponse.json({ ok: true });
}
