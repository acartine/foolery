import { NextRequest, NextResponse } from "next/server";

import { completePlan } from "@/lib/orchestration-plan-correction";
import { withServerTiming } from "@/lib/server-timing";
import {
  getPlanRouteError,
  parseRepoPath,
} from "@/app/api/plans/helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const body = await request.json().catch(() => ({}));
  const repoPath = parseRepoPath(request, body);
  if (!repoPath) {
    return NextResponse.json(
      { error: "repoPath is required" },
      { status: 400 },
    );
  }

  return withServerTiming(
    {
      route: "POST /api/plans/[planId]/complete",
      context: { planId, repoPath },
    },
    async ({ measure }) => {
      try {
        const plan = await measure(
          "complete",
          () => completePlan(planId, repoPath),
        );
        return NextResponse.json({ data: plan });
      } catch (error) {
        const routeError = getPlanRouteError(
          error,
          "Failed to complete plan",
        );
        return NextResponse.json(
          { error: routeError.message },
          { status: routeError.status },
        );
      }
    },
  );
}
