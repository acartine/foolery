import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getBackend } from "@/lib/backend-instance";
import {
  assertStaleBeatGroomingAgent,
  StaleBeatGroomingFailureError,
} from "@/lib/stale-beat-grooming-agent";
import {
  listStaleBeatGroomingReviews,
} from "@/lib/stale-beat-grooming-store";
import {
  enqueueStaleBeatGroomingReview,
} from "@/lib/stale-beat-grooming-worker";
import type {
  StaleBeatReviewTarget,
} from "@/lib/stale-beat-grooming-types";

const reviewTargetSchema = z.object({
  beatId: z.string().trim().min(1),
  repoPath: z.string().trim().min(1).optional(),
});

const reviewRequestSchema = z.object({
  agentId: z.string().trim().min(1),
  modelOverride: z.string().trim().min(1).optional(),
  targets: z.array(reviewTargetSchema).min(1).max(50),
});

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: listStaleBeatGroomingReviews(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = reviewRequestSchema.parse(
      await request.json(),
    );
    await assertStaleBeatGroomingAgent({
      agentId: body.agentId,
      modelOverride: body.modelOverride,
    });
    const targets = await canonicalizeTargets(body.targets);
    const jobs = targets.map((target) =>
      enqueueStaleBeatGroomingReview({
        target,
        agentId: body.agentId,
        modelOverride: body.modelOverride,
      })
    );
    return NextResponse.json({
      ok: true,
      data: {
        jobs: jobs.map((job) => ({
          jobId: job.id,
          beatId: job.beatId,
          ...(job.repoPath ? { repoPath: job.repoPath } : {}),
        })),
        agentId: body.agentId,
        ...(body.modelOverride
          ? { modelOverride: body.modelOverride }
          : {}),
      },
    });
  } catch (error) {
    return groomingErrorResponse(error);
  }
}

async function canonicalizeTargets(
  targets: StaleBeatReviewTarget[],
): Promise<StaleBeatReviewTarget[]> {
  return Promise.all(
    targets.map(async (target) => {
      const current = await getBackend().get(
        target.beatId,
        target.repoPath,
      );
      const beatId =
        current.ok && current.data
          ? current.data.id
          : target.beatId;
      return {
        beatId,
        ...(target.repoPath ? { repoPath: target.repoPath } : {}),
      };
    }),
  );
}

function groomingErrorResponse(error: unknown): NextResponse {
  if (error instanceof StaleBeatGroomingFailureError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }
  const message = error instanceof Error
    ? error.message
    : String(error);
  return NextResponse.json(
    { ok: false, error: message },
    { status: 400 },
  );
}
