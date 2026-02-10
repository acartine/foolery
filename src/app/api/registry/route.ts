import { NextRequest, NextResponse } from "next/server";
import { listRepos, addRepo, removeRepo } from "@/lib/registry";

export async function GET() {
  const repos = await listRepos();
  return NextResponse.json({ data: repos });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { path } = body;
  if (!path || typeof path !== "string") {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }
  try {
    const repo = await addRepo(path);
    return NextResponse.json({ data: repo }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { path } = body;
  if (!path || typeof path !== "string") {
    return NextResponse.json({ error: "Path is required" }, { status: 400 });
  }
  await removeRepo(path);
  return NextResponse.json({ ok: true });
}
