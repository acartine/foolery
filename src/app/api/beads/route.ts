import { NextRequest, NextResponse } from "next/server";
import { listBeads, createBead } from "@/lib/bd";
import { createBeadSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const result = await listBeads(params, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = createBeadSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { title, description, type, priority, labels, assignee, due, acceptance, parent, estimate } = parsed.data;
  const fields: Record<string, string | string[] | number | undefined> = {
    title,
    description,
    type,
    priority,
    labels,
    assignee,
    due,
    acceptance,
    parent,
    estimate,
  };
  const result = await createBead(fields, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
