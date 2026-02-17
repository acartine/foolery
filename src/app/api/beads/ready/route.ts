import { NextRequest, NextResponse } from "next/server";
import { readyBeads, listBeads } from "@/lib/bd";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import type { Bead } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;

  const [rawReady, rawInProgress] = await Promise.all([
    readyBeads(params, repoPath),
    listBeads({ ...params, status: "in_progress" }, repoPath),
  ]);

  const readyResult = withErrorSuppression("readyBeads", rawReady, params, repoPath);
  const inProgressResult = withErrorSuppression(
    "listBeads",
    rawInProgress,
    { ...params, status: "in_progress" },
    repoPath,
  );

  if (!readyResult.ok) {
    const status = readyResult.error === DEGRADED_ERROR_MESSAGE ? 503 : 500;
    return NextResponse.json({ error: readyResult.error }, { status });
  }

  const merged = new Map<string, Bead>();
  for (const bead of readyResult.data ?? []) merged.set(bead.id, bead);
  for (const bead of (inProgressResult.ok ? inProgressResult.data ?? [] : [])) {
    if (!merged.has(bead.id)) merged.set(bead.id, bead);
  }

  // Closed beads and those awaiting verification are never "ready"
  const result = Array.from(merged.values()).filter(
    b => b.status !== "closed" && !b.labels?.includes("stage:verification")
  );
  return NextResponse.json({ data: result });
}
