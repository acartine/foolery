import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/terminal-manager";
import { isApprovalAction } from "@/lib/approval-actions";
import {
  performApprovalAction,
} from "@/lib/terminal-approval-session";
import { withServerTiming } from "@/lib/server-timing";

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
  const action = body.action;
  if (!isApprovalAction(action)) {
    return NextResponse.json(
      { error: "Valid approval action is required" },
      { status: 400 },
    );
  }
  return withServerTiming(
    {
      route:
        "POST /api/terminal/[sessionId]/approvals/[approvalId]",
      context: { sessionId, approvalId, action },
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
        () => performApprovalAction(entry, approvalId, action),
      );
      if (!result.ok || !result.record) {
        return NextResponse.json(
          { error: result.error ?? "Approval action failed" },
          { status: result.httpStatus },
        );
      }
      return NextResponse.json({
        data: {
          approvalId: result.record.approvalId,
          action,
          status: result.record.status,
        },
      });
    },
  );
}
