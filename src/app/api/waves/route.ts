import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeadListFilters } from "@/lib/backend-port";
import { computeWaves } from "@/lib/wave-planner";
import type {
  WaveBead,
  WavePlan,
  WaveRecommendation,
  WaveReadiness,
  WaveSummary,
} from "@/lib/types";
import { beadInFinalCut, workflowDescriptorById } from "@/lib/workflows";

interface DepEdge {
  source: string; // blocker
  target: string; // blocked
}

function shortId(id: string): string {
  return id.replace(/^[^-]+-/, "");
}

function inferReadiness(
  bead: WaveBead,
  isUnschedulable: boolean,
  isInFinalCut: boolean,
): { readiness: WaveReadiness; reason: string } {
  if (isUnschedulable) {
    return {
      readiness: "unschedulable",
      reason: "Dependency cycle detected. Resolve cycle before shipping.",
    };
  }

  if (bead.type === "gate") {
    return {
      readiness: "gate",
      reason: "Gate beat. Requires human verification before progressing.",
    };
  }

  if (isInFinalCut) {
    return {
      readiness: "verification",
      reason: "Awaiting verification. Not eligible for shipping.",
    };
  }

  if (bead.status === "in_progress") {
    return {
      readiness: "in_progress",
      reason: "Already in progress.",
    };
  }

  if (bead.status === "blocked") {
    return {
      readiness: "blocked",
      reason: bead.blockedBy.length > 0
        ? `Waiting on ${bead.blockedBy.map(shortId).join(", ")}`
        : "Marked blocked.",
    };
  }

  if (bead.blockedBy.length > 0) {
    return {
      readiness: "blocked",
      reason: `Waiting on ${bead.blockedBy.map(shortId).join(", ")}`,
    };
  }

  if (bead.status === "open") {
    return {
      readiness: "runnable",
      reason: "Ready to ship.",
    };
  }

  return {
    readiness: "blocked",
    reason: `Status is ${bead.status}.`,
  };
}

function computeSummary(plan: WavePlan): WaveSummary {
  const allBeads: WaveBead[] = [
    ...plan.waves.flatMap((wave) => [
      ...wave.beads,
      ...(wave.gate ? [wave.gate] : []),
    ]),
    ...plan.unschedulable,
  ];

  let runnable = 0;
  let inProgress = 0;
  let blocked = 0;
  let verification = 0;
  let gates = 0;

  for (const bead of allBeads) {
    if (bead.readiness === "runnable") runnable += 1;
    if (bead.readiness === "in_progress") inProgress += 1;
    if (bead.readiness === "blocked") blocked += 1;
    if (bead.readiness === "verification") verification += 1;
    if (bead.readiness === "gate") gates += 1;
  }

  return {
    total: allBeads.length,
    runnable,
    inProgress,
    blocked,
    verification,
    gates,
    unschedulable: plan.unschedulable.length,
  };
}

function computeRunnableQueue(plan: WavePlan): WaveRecommendation[] {
  const queue = plan.waves
    .flatMap((wave) =>
      wave.beads
        .filter((bead) => bead.readiness === "runnable")
        .map((bead) => ({
          beadId: bead.id,
          title: bead.title,
          waveLevel: wave.level,
          reason: bead.readinessReason,
          priority: bead.priority,
        }))
    )
    .sort((a, b) => {
      if (a.waveLevel !== b.waveLevel) return a.waveLevel - b.waveLevel;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.beadId.localeCompare(b.beadId);
    });

  return queue.map((item) => ({
    beadId: item.beadId,
    title: item.title,
    waveLevel: item.waveLevel,
    reason: item.reason,
  }));
}

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("_repo") || undefined;
  const workflowsResult = await getBackend().listWorkflows(repoPath);
  const workflowsById = workflowDescriptorById(
    workflowsResult.ok ? workflowsResult.data ?? [] : [],
  );

  // Fetch all non-closed beads
  const beadsResult = await getBackend().list({ status: "open" } as BeadListFilters, repoPath);
  const inProgressResult = await getBackend().list({ status: "in_progress" } as BeadListFilters, repoPath);
  const blockedResult = await getBackend().list({ status: "blocked" } as BeadListFilters, repoPath);

  if (!beadsResult.ok) {
    return NextResponse.json(
      { error: beadsResult.error?.message ?? "Failed to fetch beads" },
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
  const finalCutIds = new Set(
    beads
      .filter((bead) => beadInFinalCut(bead, workflowsById))
      .map((bead) => bead.id),
  );

  // Fetch deps for all beads in parallel
  const depResults = await Promise.allSettled(
    beads.map((b) => getBackend().listDependencies(b.id, repoPath))
  );

  // Collect all dep edges
  const allDeps: DepEdge[] = [];
  for (const [index, result] of depResults.entries()) {
    if (result.status === "fulfilled" && result.value.ok && result.value.data) {
      for (const dep of result.value.data) {
        if (dep.dependency_type !== "blocks") continue;
        const blocker = dep.id;
        const blocked = beads[index]?.id;
        if (!blocker || !blocked) continue;
        allDeps.push({ source: blocker, target: blocked });
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
      readiness: "blocked",
      readinessReason: "",
    };
  });

  const basePlan = computeWaves(waveBeads, allDeps);
  const unschedulableIds = new Set(basePlan.unschedulable.map((b) => b.id));

  for (const wave of basePlan.waves) {
    for (const bead of wave.beads) {
      const { readiness, reason } = inferReadiness(bead, false, finalCutIds.has(bead.id));
      bead.readiness = readiness;
      bead.readinessReason = reason;
      bead.waveLevel = wave.level;
    }
    if (wave.gate) {
      const { readiness, reason } = inferReadiness(wave.gate, false, finalCutIds.has(wave.gate.id));
      wave.gate.readiness = readiness;
      wave.gate.readinessReason = reason;
      wave.gate.waveLevel = wave.level;
    }
  }

  for (const bead of basePlan.unschedulable) {
    const { readiness, reason } = inferReadiness(
      bead,
      unschedulableIds.has(bead.id),
      finalCutIds.has(bead.id),
    );
    bead.readiness = readiness;
    bead.readinessReason = reason;
  }

  const plan: WavePlan = {
    ...basePlan,
    summary: {
      total: 0,
      runnable: 0,
      inProgress: 0,
      blocked: 0,
      verification: 0,
      gates: 0,
      unschedulable: 0,
    },
    runnableQueue: [],
  };

  plan.summary = computeSummary(plan);
  plan.runnableQueue = computeRunnableQueue(plan);
  plan.recommendation = plan.runnableQueue[0];

  return NextResponse.json({ data: plan });
}
