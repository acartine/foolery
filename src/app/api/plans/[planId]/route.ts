import { NextRequest, NextResponse } from "next/server";

import { getPlan } from "@/lib/orchestration-plan-manager";
import { withServerTiming } from "@/lib/server-timing";
import { getPlanRouteError, parseRepoPath } from "@/app/api/plans/helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const repoPath = parseRepoPath(request);
  return withServerTiming(
    { route: "GET /api/plans/[planId]", context: { planId } },
    async ({ measure }) => {
      try {
        const plan = await measure(
          "get",
          () => getPlan(planId, repoPath),
        );
        if (!plan) {
          return NextResponse.json(
            { error: "Plan not found" },
            { status: 404 },
          );
        }
        return NextResponse.json({ data: plan });
      } catch (error) {
        const routeError = getPlanRouteError(
          error,
          "Failed to load plan",
        );
        return NextResponse.json(
          { error: routeError.message },
          { status: routeError.status },
        );
      }
    },
  );
}
