import { NextRequest, NextResponse } from "next/server";
import { readAgentHistory } from "@/lib/agent-history";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("_repo") ?? undefined;
  const beadId = request.nextUrl.searchParams.get("beadId") ?? undefined;
  const beadRepoPath = request.nextUrl.searchParams.get("beadRepo") ?? undefined;
  const sinceHoursRaw = request.nextUrl.searchParams.get("sinceHours");
  const sinceHours =
    sinceHoursRaw !== null && sinceHoursRaw.trim() !== ""
      ? Number.parseInt(sinceHoursRaw, 10)
      : undefined;

  try {
    const data = await readAgentHistory({
      repoPath,
      beadId,
      beadRepoPath: beadId ? beadRepoPath : undefined,
      ...(Number.isFinite(sinceHours ?? Number.NaN) ? { sinceHours } : {}),
    });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agent history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
