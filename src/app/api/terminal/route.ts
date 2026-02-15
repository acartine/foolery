import { NextRequest, NextResponse } from "next/server";
import { createSession, createSceneSession, abortSession, listSessions } from "@/lib/terminal-manager";

export async function GET() {
  return NextResponse.json({ data: listSessions() });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { beadId, beadIds, prompt, _repo } = body;

  // Scene! mode: beadIds is an array of multiple beads
  if (Array.isArray(beadIds) && beadIds.length > 0) {
    if (!beadIds.every((id: unknown) => typeof id === "string")) {
      return NextResponse.json(
        { error: "beadIds must be an array of strings" },
        { status: 400 }
      );
    }
    try {
      const session = await createSceneSession(beadIds, _repo);
      return NextResponse.json({ data: session }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create scene session";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Take! mode: single beadId
  if (!beadId || typeof beadId !== "string") {
    return NextResponse.json(
      { error: "beadId or beadIds is required" },
      { status: 400 }
    );
  }

  try {
    const session = await createSession(beadId, _repo, prompt);
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { sessionId } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }

  const ok = abortSession(sessionId);
  if (!ok) {
    return NextResponse.json(
      { error: "Session not found or already stopped" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
