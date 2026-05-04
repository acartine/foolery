import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  STALE_BEAT_AGE_DAYS,
} from "@/lib/stale-beat-grooming-types";
import {
  listStaleBeatSummariesForApi,
} from "@/lib/stale-beat-grooming-list";

const listQuerySchema = z.object({
  _repo: z.string().trim().min(1).optional(),
  scope: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  ageDays: z.coerce.number().int().positive().max(3650)
    .default(STALE_BEAT_AGE_DAYS),
});

export async function GET(request: NextRequest) {
  try {
    const query = listQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const staleBeats = await listStaleBeatSummariesForApi({
      repoPath: query._repo,
      scope: query.scope,
      limit: query.limit,
      ageDays: query.ageDays,
    });
    return NextResponse.json({
      ok: true,
      data: {
        staleBeats,
        count: staleBeats.length,
        ageDays: query.ageDays,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : String(error),
      },
      { status: 400 },
    );
  }
}
