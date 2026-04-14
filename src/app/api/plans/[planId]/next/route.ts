import { NextRequest, NextResponse } from "next/server";

import {
  getNextPlanStep,
} from "@/lib/orchestration-plan-manager";
import { withServerTiming } from "@/lib/server-timing";
import {
  getPlanRouteError,
  parseRepoPath,
} from "@/app/api/plans/helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const repoPath = parseRepoPath(request);

  return withServerTiming(
    {
      route: "GET /api/plans/[planId]/next",
      context: { planId, repoPath },
    },
    async ({ measure }) => {
      try {
        const step = await measure(
          "next",
          () => getNextPlanStep(planId, repoPath),
        );
        return NextResponse.json({ data: step });
      } catch (error) {
        const routeError = getPlanRouteError(
          error,
          "Failed to resolve next step",
        );
        return NextResponse.json(
          { error: routeError.message },
          { status: routeError.status },
        );
      }
    },
  );
}
