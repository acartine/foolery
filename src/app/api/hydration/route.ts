import { NextRequest, NextResponse } from "next/server";
import { showBead } from "@/lib/bd";
import {
  abortHydrationSession,
  createHydrationSession,
} from "@/lib/hydration-manager";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const repoPath =
    typeof body?._repo === "string" && body._repo.trim()
      ? body._repo.trim()
      : "";
  const parentBeadId =
    typeof body?.parentBeadId === "string" && body.parentBeadId.trim()
      ? body.parentBeadId.trim()
      : "";

  if (!repoPath) {
    return NextResponse.json({ error: "_repo is required" }, { status: 400 });
  }
  if (!parentBeadId) {
    return NextResponse.json(
      { error: "parentBeadId is required" },
      { status: 400 }
    );
  }

  try {
    const parentResult = await showBead(parentBeadId, repoPath);
    if (!parentResult.ok || !parentResult.data) {
      return NextResponse.json(
        { error: `Parent bead not found: ${parentBeadId}` },
        { status: 404 }
      );
    }

    const parent = parentResult.data;
    const session = await createHydrationSession(
      repoPath,
      parentBeadId,
      parent.title,
      parent.description ?? ""
    );
    return NextResponse.json({ data: session }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start hydration";
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

  const ok = abortHydrationSession(sessionId);
  if (!ok) {
    return NextResponse.json(
      { error: "Session not found or already stopped" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
