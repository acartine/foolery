import { NextRequest, NextResponse } from "next/server";
import { createSession, abortSession, listSessions } from "@/lib/terminal-manager";
import { withServerTiming } from "@/lib/server-timing";

export async function GET() {
  return withServerTiming(
    { route: "GET /api/terminal" },
    async ({ measure }) => NextResponse.json({ data: await measure("list", () => listSessions()) }),
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { beatId, prompt, _repo } = body;

  if (!beatId || typeof beatId !== "string") {
    return NextResponse.json(
      { error: "beatId is required" },
      { status: 400 }
    );
  }

  return withServerTiming(
    { route: "POST /api/terminal", context: { beatId, repoPath: _repo } },
    async ({ measure }) => {
      try {
        const session = await measure("create", () => createSession(beatId, _repo, prompt));
        return NextResponse.json({ data: session }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create session";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
  );
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

  return withServerTiming(
    { route: "DELETE /api/terminal", context: { sessionId } },
    async ({ measure }) => {
      const ok = await measure("abort", () => abortSession(sessionId));
      if (!ok) {
        return NextResponse.json(
          { error: "Session not found or already stopped" },
          { status: 404 }
        );
      }

      return NextResponse.json({ ok: true });
    },
  );
}
