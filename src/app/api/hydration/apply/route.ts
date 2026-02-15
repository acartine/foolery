import { NextRequest, NextResponse } from "next/server";
import { applyHydrationPlan } from "@/lib/hydration-manager";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "";
  const repoPath =
    typeof body?._repo === "string" && body._repo.trim()
      ? body._repo.trim()
      : "";

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }
  if (!repoPath) {
    return NextResponse.json(
      { error: "_repo is required" },
      { status: 400 }
    );
  }

  try {
    const result = await applyHydrationPlan(sessionId, repoPath);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to apply hydration plan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
