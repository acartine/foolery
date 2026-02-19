import { NextRequest, NextResponse } from "next/server";
import { listBeads } from "@/lib/bd";
import { withErrorSuppression, DEGRADED_ERROR_MESSAGE } from "@/lib/bd-error-suppression";
import { filterByVisibleAncestorChain } from "@/lib/ready-ancestor-filter";
import type { Bead } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const repoPath = params._repo;
  delete params._repo;
  const query = params.q;
  delete params.q;

  // Query open + in_progress beads via bd list (which returns labels)
  // instead of bd ready (which omits labels from its JSON output).
  const [rawOpen, rawInProgress] = await Promise.all([
    listBeads({ ...params, status: "open" }, repoPath),
    listBeads({ ...params, status: "in_progress" }, repoPath),
  ]);

  const openResult = withErrorSuppression("listBeads", rawOpen, { ...params, status: "open" }, repoPath);
  const inProgressResult = withErrorSuppression(
    "listBeads",
    rawInProgress,
    { ...params, status: "in_progress" },
    repoPath,
  );

  if (!openResult.ok) {
    const status = openResult.error === DEGRADED_ERROR_MESSAGE ? 503 : 500;
    return NextResponse.json({ error: openResult.error }, { status });
  }

  const merged = new Map<string, Bead>();
  for (const bead of openResult.data ?? []) merged.set(bead.id, bead);
  for (const bead of (inProgressResult.ok ? inProgressResult.data ?? [] : [])) {
    if (!merged.has(bead.id)) merged.set(bead.id, bead);
  }

  // Beads awaiting verification are not "ready"
  let result = Array.from(merged.values()).filter(
    b => !b.labels?.includes("stage:verification")
  );

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
