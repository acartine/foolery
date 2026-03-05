import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import { queryBeatSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { _repo: repoPath, ...rest } = body;
  const parsed = queryBeatSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const { expression, limit, sort } = parsed.data;
  const result = await getBackend().query(expression, { limit, sort }, repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message },
      { status: backendErrorStatus(result.error) },
    );
  }
  return NextResponse.json({ data: result.data });
}
