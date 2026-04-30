import { NextRequest, NextResponse } from "next/server";
import {
  clearFixtureSessions,
  createFixtureSession,
  emitFixtureEvent,
} from "@/lib/terminal-test-fixture";
import { listSessions } from "@/lib/terminal-manager";
import type { TerminalEvent } from "@/lib/types";

function fixtureEnabled(): boolean {
  return process.env.FOOLERY_E2E_TERMINAL_FIXTURE === "1";
}

function fixtureNotFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404 },
  );
}

export async function GET() {
  if (!fixtureEnabled()) return fixtureNotFound();
  return NextResponse.json({ data: listSessions() });
}

export async function POST(request: NextRequest) {
  if (!fixtureEnabled()) return fixtureNotFound();

  const body = await request.json();
  const action =
    typeof body.action === "string"
      ? body.action
      : "";

  if (action === "clear") {
    clearFixtureSessions();
    return NextResponse.json({ ok: true });
  }

  if (action === "create") {
    const session = createFixtureSession({
      id: body.id,
      beatId: body.beatId,
      beatTitle: body.beatTitle,
      repoPath: body.repoPath,
      knotsLeaseId: body.knotsLeaseId,
      agentName: body.agentName,
      agentModel: body.agentModel,
      agentVersion: body.agentVersion,
      agentProvider: body.agentProvider,
      startedAt: body.startedAt,
    });
    return NextResponse.json({ data: session });
  }

  if (action === "event") {
    const event: TerminalEvent = {
      type: body.event?.type,
      data: body.event?.data,
      timestamp: body.event?.timestamp ?? Date.now(),
    };
    const ok = emitFixtureEvent(body.sessionId, event);
    return NextResponse.json(
      ok ? { ok: true } : { error: "Session not found" },
      { status: ok ? 200 : 404 },
    );
  }

  return NextResponse.json(
    { error: "Unknown fixture action" },
    { status: 400 },
  );
}
