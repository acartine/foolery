import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { closeBeadSchema } from "@/lib/schemas";
import { regroomAncestors } from "@/lib/regroom";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = closeBeadSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const result = await getBackend().close(id, parsed.data.reason, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error?.message }, { status: 500 });
  }

  // Auto-close ancestors whose children are all closed
  await regroomAncestors(id, repoPath);

  return NextResponse.json({ ok: true });
}
