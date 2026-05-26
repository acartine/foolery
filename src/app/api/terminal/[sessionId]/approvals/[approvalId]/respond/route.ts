import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/terminal-manager";
import {
  applyApprovalAction,
} from "@/lib/terminal-approval-session";
import { withServerTiming } from "@/lib/server-timing";

const MAX_RESPONSE_CHARS = 8_000;

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      sessionId: string;
      approvalId: string;
    }>;
  },
) {
  const { sessionId, approvalId } = await params;
  const body = await request.json().catch(() => ({}));
  const raw = typeof body?.text === "string" ? body.text : "";
  const text = raw.trim();
  if (text.length === 0) {
    return NextResponse.json(
      { error: "Response text is required" },
      { status: 400 },
    );
  }
  if (text.length > MAX_RESPONSE_CHARS) {
    return NextResponse.json(
      {
        error:
          "Response text exceeds " +
          `${MAX_RESPONSE_CHARS} characters`,
      },
      { status: 400 },
    );
  }
  return withServerTiming(
    {
      route:
        "POST /api/terminal/[sessionId]/approvals/" +
        "[approvalId]/respond",
      context: { sessionId, approvalId },
    },
    async ({ measure }) => {
      const entry = getSession(sessionId);
      if (!entry) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      const result = await measure(
        "approval",
        () =>
          applyApprovalAction(approvalId, "respond", { text }),
      );
      if (!result.ok || !result.record) {
        return NextResponse.json(
          { error: result.error ?? "Approval respond failed" },
          { status: result.httpStatus },
        );
      }
      return NextResponse.json({
        data: {
          approvalId: result.record.approvalId,
          action: "respond",
          status: result.record.status,
        },
      });
    },
  );
}
