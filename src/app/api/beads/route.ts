import { NextRequest, NextResponse } from "next/server";
import { listBeads, searchBeads, createBead } from "@/lib/bd";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { createBeadSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;
  const raw = query
    ? await searchBeads(query, params, repoPath)
    : await listBeads(params, repoPath);
  const fn = query ? "searchBeads" : "listBeads";
  const result = withErrorSuppression(fn, raw, params, repoPath, query);
  if (!result.ok) {
    const status = result.error === DEGRADED_ERROR_MESSAGE ? 503 : 500;
    return NextResponse.json({ error: result.error }, { status });
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
  const { title, description, type, priority, labels, assignee, due, acceptance, notes, parent, estimate } = parsed.data;
  const fields: Record<string, string | string[] | number | undefined> = {
    title,
    description,
    type,
    priority,
    labels,
    assignee,
    due,
    acceptance,
    notes,
    parent,
    estimate,
  };
  const result = await createBead(fields, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
