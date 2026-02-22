import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeadListFilters } from "@/lib/backend-port";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { createBeadSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;
  const raw = query
    ? await getBackend().search(query, params as BeadListFilters, repoPath)
    : await getBackend().list(params as BeadListFilters, repoPath);
  const fn = query ? "searchBeads" : "listBeads";
  const result = withErrorSuppression(fn, raw, params, repoPath, query);
  if (!result.ok) {
    const status = result.error?.message === DEGRADED_ERROR_MESSAGE ? 503 : 500;
    return NextResponse.json({ error: result.error?.message }, { status });
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
  const result = await getBackend().create(parsed.data, repoPath);
  if (!result.ok) {
    return NextResponse.json({ error: result.error?.message }, { status: 500 });
  }
  return NextResponse.json({ data: result.data }, { status: 201 });
}
