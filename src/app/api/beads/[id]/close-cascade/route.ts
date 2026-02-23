import { NextRequest, NextResponse } from "next/server";
import { backendErrorStatus } from "@/lib/backend-http";
import { cascadeCloseSchema } from "@/lib/schemas";
import { getOpenDescendants, cascadeClose } from "@/lib/cascade-close";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = cascadeCloseSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!parsed.data.confirmed) {
    // Preview mode: return the list of descendants that would be closed
    const result = await getOpenDescendants(id, repoPath);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error?.message ?? "Failed to list descendants" },
        { status: backendErrorStatus(result.error) },
      );
    }
    return NextResponse.json({ ok: true, data: { descendants: result.data } });
  }

  // Confirmed: close all descendants then the parent
  const result = await cascadeClose(id, parsed.data.reason, repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message ?? "Failed to close descendants" },
      { status: backendErrorStatus(result.error) },
    );
  }
  return NextResponse.json({ ok: true, data: result.data });
}
