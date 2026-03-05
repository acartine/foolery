import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import {
  abortBreakdownSession,
  createBreakdownSession,
} from "@/lib/breakdown-manager";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const repoPath =
    typeof body?._repo === "string" && body._repo.trim()
      ? body._repo.trim()
      : "";
  const parentBeatId =
    typeof body?.parentBeatId === "string" && body.parentBeatId.trim()
      ? body.parentBeatId.trim()
      : "";

  if (!repoPath) {
    return NextResponse.json({ error: "_repo is required" }, { status: 400 });
  }
  if (!parentBeatId) {
    return NextResponse.json(
      { error: "parentBeatId is required" },
      { status: 400 }
    );
  }

  try {
    const parentResult = await getBackend().get(parentBeatId, repoPath);
    if (!parentResult.ok || !parentResult.data) {
      return NextResponse.json(
        { error: `Parent beat not found: ${parentBeatId}` },
        { status: 404 }
      );
    }

    const parent = parentResult.data;
    const session = await createBreakdownSession(
      repoPath,
      parentBeatId,
      parent.title,
      parent.description ?? ""
    );
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start breakdown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : "";

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }

  const ok = abortBreakdownSession(sessionId);
  if (!ok) {
    return NextResponse.json(
      { error: "Session not found or already stopped" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
