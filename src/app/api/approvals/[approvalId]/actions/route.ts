import { NextRequest, NextResponse } from "next/server";
import { isApprovalAction } from "@/lib/approval-actions";
import {
  applyApprovalAction,
} from "@/lib/terminal-approval-session";
import {
  approvalDtoFromEntry,
  getApproval,
} from "@/lib/approval-registry";
import { withServerTiming } from "@/lib/server-timing";

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ approvalId: string }>;
  },
) {
  const { approvalId } = await params;
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
      route: "POST /api/approvals/[approvalId]/actions",
      context: { approvalId, action },
    },
    async ({ measure }) => {
      const result = await measure(
        "approval",
        () => applyApprovalAction(approvalId, action),
      );
      if (result.ok && result.record) {
        const dto = approvalDtoFromEntry(
          getApproval(approvalId)!,
        );
        return NextResponse.json({
          data: {
            approvalId: result.record.approvalId,
            action,
            status: result.record.status,
            record: dto,
          },
        });
      }
      const entry = getApproval(approvalId);
      const errorBody: Record<string, unknown> = {
        error: result.error ?? "Approval action failed",
      };
      if (result.code) errorBody.code = result.code;
      if (entry) {
        errorBody.record = approvalDtoFromEntry(entry);
      }
      return NextResponse.json(
        errorBody,
        { status: result.httpStatus },
      );
    },
  );
}
