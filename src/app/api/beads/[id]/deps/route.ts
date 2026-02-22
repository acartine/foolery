import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { addDepSchema } from "@/lib/schemas";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const result = await getBackend().listDependencies(id, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error?.message }, { status: 500 });
  }
  return NextResponse.json({ data: result.data });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = addDepSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const result = await getBackend().addDependency(id, parsed.data.blocks, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error?.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
