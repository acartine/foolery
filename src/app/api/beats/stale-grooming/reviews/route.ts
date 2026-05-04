import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getBackend } from "@/lib/backend-instance";
import {
  assertStaleBeatGroomingAgent,
  StaleBeatGroomingFailureError,
} from "@/lib/stale-beat-grooming-agent";
import {
  STALE_BEAT_AGE_DAYS,
} from "@/lib/stale-beat-grooming-types";
import {
  listStaleBeatGroomingReviews,
} from "@/lib/stale-beat-grooming-store";
import {
  listStaleBeatSummariesForApi,
} from "@/lib/stale-beat-grooming-list";
import {
  enqueueStaleBeatGroomingReview,
} from "@/lib/stale-beat-grooming-worker";
import type {
  StaleBeatReviewTarget,
  StaleBeatReviewStatus,
} from "@/lib/stale-beat-grooming-types";
import type { AgentTarget } from "@/lib/types-agent-target";

const reviewTargetSchema = z.object({
  beatId: z.string().trim().min(1),
  repoPath: z.string().trim().min(1).optional(),
});

const reviewRequestSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  targets: z.array(reviewTargetSchema).min(1).max(50).optional(),
  mode: z.enum(["oldest"]).optional(),
  limit: z.coerce.number().int().positive().max(50).default(5),
  _repo: z.string().trim().min(1).optional(),
  scope: z.string().trim().optional(),
  ageDays: z.coerce.number().int().positive().max(3650)
    .default(STALE_BEAT_AGE_DAYS),
}).refine((body) =>
  body.targets?.length || body.mode === "oldest", {
  message: "provide targets or mode=\"oldest\"",
});

export async function GET(request?: NextRequest) {
  const status = request?.nextUrl.searchParams.get("status");
  const reviews = listStaleBeatGroomingReviews().filter((review) =>
    isReviewStatus(status) ? review.status === status : true
  );
  return NextResponse.json({
    ok: true,
    data: reviews,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = reviewRequestSchema.parse(
      await request.json(),
    );
    const agent = await assertStaleBeatGroomingAgent({
      agentId: body.agentId,
    });
    const agentId = resolvedAgentId(agent, body.agentId);
    const targets = await reviewTargets(body);
    const jobs = targets.map((target) =>
      enqueueStaleBeatGroomingReview({
        target,
        agentId,
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
        agentId,
      },
    });
  } catch (error) {
    return groomingErrorResponse(error);
  }
}

async function reviewTargets(
  body: z.infer<typeof reviewRequestSchema>,
): Promise<StaleBeatReviewTarget[]> {
  if (body.mode === "oldest") {
    const summaries = await listStaleBeatSummariesForApi({
      repoPath: body._repo,
      scope: body.scope,
      ageDays: body.ageDays,
      limit: body.limit,
    });
    return summaries.map((summary) => ({
      beatId: summary.beatId,
      ...(summary.repoPath ? { repoPath: summary.repoPath } : {}),
    }));
  }
  return canonicalizeTargets(body.targets ?? []);
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

function resolvedAgentId(
  agent: AgentTarget,
  requestedAgentId?: string,
): string {
  const agentId = agent.agentId ?? requestedAgentId?.trim();
  if (!agentId) {
    throw new StaleBeatGroomingFailureError(
      "stale grooming resolved an agent without an agent id; "
        + "check actions.staleGrooming or pools.stale_grooming",
      503,
    );
  }
  return agentId;
}

function isReviewStatus(
  value: string | null | undefined,
): value is StaleBeatReviewStatus {
  return value === "queued"
    || value === "running"
    || value === "completed"
    || value === "failed";
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
