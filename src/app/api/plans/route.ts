import { NextRequest, NextResponse } from "next/server";

import {
  createPlan,
  listPlans,
} from "@/lib/orchestration-plan-manager";
import { withServerTiming } from "@/lib/server-timing";
import { parseRepoPath } from "@/app/api/plans/helpers";

export async function GET(request: NextRequest) {
  const repoPath = parseRepoPath(request);
  if (!repoPath) {
    return NextResponse.json(
      { error: "repoPath is required" },
      { status: 400 },
    );
  }

  return withServerTiming(
    {
      route: "GET /api/plans",
      context: { repoPath },
    },
    async ({ measure }) => {
      try {
        const plans = await measure(
          "list",
          () => listPlans(repoPath),
        );
        return NextResponse.json({ data: plans });
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to list plans",
          },
          { status: 500 },
        );
      }
    },
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const repoPath = parseRepoPath(request, body);
  if (!repoPath) {
    return NextResponse.json(
      { error: "repoPath is required" },
      { status: 400 },
    );
  }

  const objective =
    typeof body?.objective === "string" &&
    body.objective.trim()
      ? body.objective.trim()
      : undefined;
  const model =
    typeof body?.model === "string" && body.model.trim()
      ? body.model.trim()
      : undefined;
  const mode =
    body?.mode === "scene" || body?.mode === "groom"
      ? body.mode
      : undefined;

  return withServerTiming(
    {
      route: "POST /api/plans",
      context: { repoPath, objective, mode },
    },
    async ({ measure }) => {
      try {
        const plan = await measure(
          "create",
          () =>
            createPlan({
              repoPath,
              objective,
              model,
              mode,
            }),
        );
        return NextResponse.json(
          { data: plan },
          { status: 201 },
        );
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to create plan",
          },
          { status: 500 },
        );
      }
    },
  );
}
