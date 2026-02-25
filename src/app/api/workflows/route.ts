import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const result = await getBackend().listWorkflows(repoPath);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error?.message ?? "Failed to list workflows" },
      { status: backendErrorStatus(result.error) },
    );
  }
  return NextResponse.json({ data: result.data ?? [] });
}
