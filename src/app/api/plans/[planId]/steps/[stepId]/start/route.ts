import { NextRequest, NextResponse } from "next/server";

import {
  startPlanStep,
} from "@/lib/orchestration-plan-manager";
import { withServerTiming } from "@/lib/server-timing";
import {
  getPlanRouteError,
  parseRepoPath,
} from "@/app/api/plans/helpers";

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planId: string; stepId: string }>;
  },
) {
  const { planId, stepId } = await params;
  const body = await request.json().catch(() => ({}));
  const repoPath = parseRepoPath(request, body);

  return withServerTiming(
    {
      route: "POST /api/plans/[planId]/steps/[stepId]/start",
      context: { planId, stepId, repoPath },
    },
    async ({ measure }) => {
      try {
        const result = await measure(
          "start",
          () => startPlanStep(planId, stepId, repoPath),
        );
        return NextResponse.json({ data: result });
      } catch (error) {
        const routeError = getPlanRouteError(
          error,
          "Failed to start plan step",
        );
        return NextResponse.json(
          { error: routeError.message },
          { status: routeError.status },
        );
      }
    },
  );
}
