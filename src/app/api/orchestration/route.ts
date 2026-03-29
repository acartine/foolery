import { NextRequest, NextResponse } from "next/server";
import {
  abortOrchestrationSession,
  createOrchestrationSession,
  listOrchestrationSessions,
} from "@/lib/orchestration-manager";
import { withServerTiming } from "@/lib/server-timing";

export async function GET() {
  return withServerTiming(
    { route: "GET /api/orchestration" },
    async ({ measure }) => NextResponse.json({
      data: await measure("list", () => listOrchestrationSessions()),
    }),
  );
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

  return withServerTiming(
    {
      route: "POST /api/orchestration",
      context: { repoPath },
    },
    async ({ measure }) => {
      try {
        const session = await measure(
          "create",
          () => createOrchestrationSession(repoPath, objective),
        );
        return NextResponse.json({ data: session }, { status: 201 });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start orchestration";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
  );
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

  return withServerTiming(
    {
      route: "DELETE /api/orchestration",
      context: { sessionId },
    },
    async ({ measure }) => {
      const ok = await measure("abort", () => abortOrchestrationSession(sessionId));
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
