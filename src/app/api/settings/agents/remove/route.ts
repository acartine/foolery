import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getAgentRemovalImpact } from "@/lib/settings";
import { logApiError } from "@/lib/server-logger";

const querySchema = z.object({
  id: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.parse({
      id: request.nextUrl.searchParams.get("id"),
    });
    const impact = await getAgentRemovalImpact(
      parsed.id,
    );
    return NextResponse.json({
      ok: true,
      data: impact,
    });
  } catch (err) {
    logApiError({
      method: "GET",
      path: "/api/settings/agents/remove",
      status: 400,
      error: (err as Error).message,
    });
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}
