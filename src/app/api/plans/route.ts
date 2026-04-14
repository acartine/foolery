import { NextRequest, NextResponse } from "next/server";

import {
  createPlan,
  getPlan,
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
  const beatIds = Array.isArray(body?.beatIds)
    ? body.beatIds
        .filter(
          (beatId: unknown): beatId is string =>
            typeof beatId === "string",
        )
        .map((beatId: string) => beatId.trim())
        .filter((beatId: string) => beatId.length > 0)
    : [];
  if (beatIds.length === 0) {
    return NextResponse.json(
      { error: "beatIds is required" },
      { status: 400 },
    );
  }
  const mode =
    body?.mode === "scene" || body?.mode === "groom"
      ? body.mode
      : undefined;
  const replacesPlanId =
    typeof body?.replacesPlanId === "string" &&
    body.replacesPlanId.trim()
      ? body.replacesPlanId.trim()
      : undefined;

  return withServerTiming(
    {
      route: "POST /api/plans",
      context: {
        repoPath,
        objective,
        mode,
        beatCount: beatIds.length,
      },
    },
    async ({ measure }) => {
      try {
        const created = await measure(
          "create",
          () =>
            createPlan({
              repoPath,
              beatIds,
              objective,
              model,
              mode,
              replacesPlanId,
            }),
        );
        const plan = await measure(
          "read_created",
          () => getPlan(created.planId, repoPath),
        );
        if (!plan) {
          throw new Error(
            `Created plan ${created.planId} could not be loaded.`,
          );
        }
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
