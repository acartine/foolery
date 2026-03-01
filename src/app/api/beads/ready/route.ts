import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import { backendErrorStatus } from "@/lib/backend-http";
import type { BeatListFilters } from "@/lib/backend-port";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { filterByVisibleAncestorChain } from "@/lib/ready-ancestor-filter";
import type { Beat } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;

  // Query open + in_progress items via backend.list (which returns labels)
  // instead of backend.listReady (which can omit labels depending on backend).
  const [rawOpen, rawInProgress] = await Promise.all([
    getBackend().list({ ...params, state: "open" } as BeatListFilters, repoPath),
    getBackend().list({ ...params, state: "in_progress" } as BeatListFilters, repoPath),
  ]);

  const openResult = withErrorSuppression("listBeads", rawOpen, { ...params, state: "open" }, repoPath);
  const inProgressResult = withErrorSuppression(
    "listBeads",
    rawInProgress,
    { ...params, state: "in_progress" },
    repoPath,
  );

  if (!openResult.ok) {
    const status = openResult.error?.message === DEGRADED_ERROR_MESSAGE
      ? 503
      : backendErrorStatus(openResult.error);
    return NextResponse.json({ error: openResult.error?.message }, { status });
  }

  const merged = new Map<string, Beat>();
  for (const beat of openResult.data ?? []) merged.set(beat.id, beat);
  for (const beat of (inProgressResult.ok ? inProgressResult.data ?? [] : [])) {
    if (!merged.has(beat.id)) merged.set(beat.id, beat);
  }

  // Human-action queue beats are not \"ready\" for agent execution.
  let result = Array.from(merged.values()).filter((beat) => !beat.requiresHumanAction);

  // Hide descendants whose parent chain is not in the ready/in-progress set.
  result = filterByVisibleAncestorChain(result);

  // Client-side search filtering
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(b =>
      b.id.toLowerCase().includes(q) ||
      (b.title && b.title.toLowerCase().includes(q)) ||
      (b.description && b.description.toLowerCase().includes(q))
    );
  }

  return NextResponse.json({ data: result });
}
