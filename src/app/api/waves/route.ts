import { NextRequest, NextResponse } from "next/server";
import { listBeads, listDeps } from "@/lib/bd";
import { computeWaves } from "@/lib/wave-planner";
import type { WaveBead } from "@/lib/types";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;

  // Fetch all non-closed beads
  const beadsResult = await listBeads({ status: "open" }, repoPath);
  const inProgressResult = await listBeads({ status: "in_progress" }, repoPath);
  const blockedResult = await listBeads({ status: "blocked" }, repoPath);

  if (!beadsResult.ok) {
    return NextResponse.json(
      { error: beadsResult.error ?? "Failed to fetch beads" },
      { status: 500 }
    );
  }

  const allBeads = [
    ...(beadsResult.data ?? []),
    ...(inProgressResult.data ?? []),
    ...(blockedResult.data ?? []),
  ];

  // Deduplicate by ID
  const seen = new Set<string>();
  const beads = allBeads.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });

  // Fetch deps for all beads in parallel
  const depResults = await Promise.allSettled(
    beads.map((b) => listDeps(b.id, repoPath))
  );

  // Collect all dep edges
  const allDeps: { source: string; target: string }[] = [];
  for (const result of depResults) {
    if (result.status === "fulfilled" && result.value.ok && result.value.data) {
      for (const dep of result.value.data) {
        allDeps.push({ source: dep.source, target: dep.target });
      }
    }
  }

  // Build WaveBeads
  const waveBeads: WaveBead[] = beads.map((b) => {
    const blockedBy = allDeps
      .filter((d) => d.target === b.id)
      .map((d) => d.source);
    return {
      id: b.id,
      title: b.title,
      type: b.type,
      status: b.status,
      priority: b.priority,
      labels: b.labels ?? [],
      blockedBy,
    };
  });

  const plan = computeWaves(waveBeads, allDeps);
  return NextResponse.json({ data: plan });
}
