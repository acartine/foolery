import { NextRequest, NextResponse } from "next/server";
import { killSession } from "@/lib/terminal-manager";
import { withServerTiming } from "@/lib/server-timing";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  return withServerTiming(
    {
      route: "POST /api/terminal/[sessionId]/kill",
      context: { sessionId },
    },
    async ({ measure }) => {
      const result = await measure(
        "kill",
        () => killSession(sessionId),
      );
      if (!result.ok) {
        const status = result.reason === "not_found"
          ? 404
          : 410;
        const error = result.reason === "not_found"
          ? "Session not found"
          : "Session already exited";
        const statusBody = result.reason === "already_exited"
          ? { status: result.status }
          : {};
        return NextResponse.json(
          { error, ...statusBody },
          { status },
        );
      }

      return NextResponse.json({ data: result.session });
    },
  );
}
