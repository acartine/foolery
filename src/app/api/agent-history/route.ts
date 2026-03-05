import { NextRequest, NextResponse } from "next/server";
import { readAgentHistory } from "@/lib/agent-history";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("_repo") ?? undefined;
  // Accept both "beatId" (current client) and "beadId" (legacy) param names
  const beatId = request.nextUrl.searchParams.get("beatId")
    ?? request.nextUrl.searchParams.get("beadId")
    ?? undefined;
  const beatRepoPath = request.nextUrl.searchParams.get("beatRepo") ?? undefined;
  const sinceHoursRaw = request.nextUrl.searchParams.get("sinceHours");
  const sinceHours =
    sinceHoursRaw !== null && sinceHoursRaw.trim() !== ""
      ? Number.parseInt(sinceHoursRaw, 10)
      : undefined;

  try {
    const data = await readAgentHistory({
      repoPath,
      beatId,
      beatRepoPath: beatId ? beatRepoPath : undefined,
      ...(Number.isFinite(sinceHours ?? Number.NaN) ? { sinceHours } : {}),
    });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agent history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
