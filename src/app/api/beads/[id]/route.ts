import { NextRequest, NextResponse } from "next/server";
import { showBead, updateBead, deleteBead } from "@/lib/bd";
import { updateBeadSchema } from "@/lib/schemas";

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
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const result = await deleteBead(id, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
