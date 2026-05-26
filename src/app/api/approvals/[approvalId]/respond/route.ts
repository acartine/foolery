import { NextRequest, NextResponse } from "next/server";
import {
  applyApprovalAction,
} from "@/lib/terminal-approval-session";
import {
  approvalDtoFromEntry,
  getApproval,
} from "@/lib/approval-registry";
import { withServerTiming } from "@/lib/server-timing";

const MAX_RESPONSE_CHARS = 8_000;

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
      route: "POST /api/approvals/[approvalId]/respond",
      context: { approvalId },
    },
    async ({ measure }) => {
      const result = await measure(
        "approval",
        () =>
          applyApprovalAction(approvalId, "respond", { text }),
      );
      if (result.ok && result.record) {
        const dto = approvalDtoFromEntry(
          getApproval(approvalId)!,
        );
        return NextResponse.json({
          data: {
            approvalId: result.record.approvalId,
            action: "respond",
            status: result.record.status,
            record: dto,
          },
        });
      }
      const entry = getApproval(approvalId);
      const errorBody: Record<string, unknown> = {
        error: result.error ?? "Approval respond failed",
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
