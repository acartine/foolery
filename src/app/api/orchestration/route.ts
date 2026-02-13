import { NextRequest, NextResponse } from "next/server";
import {
  abortOrchestrationSession,
  createOrchestrationSession,
  listOrchestrationSessions,
} from "@/lib/orchestration-manager";

export async function GET() {
  return NextResponse.json({ data: listOrchestrationSessions() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const repoPath =
    typeof body?._repo === "string" && body._repo.trim()
      ? body._repo.trim()
      : "";
  const objective =
    typeof body?.objective === "string" && body.objective.trim()
      ? body.objective.trim()
      : undefined;

  if (!repoPath) {
    return NextResponse.json(
      { error: "_repo is required" },
      { status: 400 }
    );
  }

  try {
    const session = await createOrchestrationSession(repoPath, objective);
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start orchestration";
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

  const ok = abortOrchestrationSession(sessionId);
  if (!ok) {
    return NextResponse.json(
      { error: "Session not found or already stopped" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
