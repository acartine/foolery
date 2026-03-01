import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeatListFilters } from "@/lib/backend-port";
import { computeWaves } from "@/lib/wave-planner";
import type {
  WaveBeat,
  WavePlan,
  WaveRecommendation,
  WaveReadiness,
  WaveSummary,
} from "@/lib/types";
import { beatInFinalCut, workflowDescriptorById } from "@/lib/workflows";

interface DepEdge {
  source: string; // blocker
  target: string; // blocked
}

function shortId(id: string): string {
  return id.replace(/^[^-]+-/, "");
}

function inferReadiness(
  beat: WaveBeat,
  isUnschedulable: boolean,
  isInFinalCut: boolean,
): { readiness: WaveReadiness; reason: string } {
  if (isUnschedulable) {
    return {
      readiness: "unschedulable",
      reason: "Dependency cycle detected. Resolve cycle before shipping.",
    };
  }

  if (beat.type === "gate") {
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

  if (beat.state === "in_progress") {
    return {
      readiness: "in_progress",
      reason: "Already in progress.",
    };
  }

  if (beat.state === "blocked") {
    return {
      readiness: "blocked",
      reason: beat.blockedBy.length > 0
        ? `Waiting on ${beat.blockedBy.map(shortId).join(", ")}`
        : "Marked blocked.",
    };
  }

  if (beat.blockedBy.length > 0) {
    return {
      readiness: "blocked",
      reason: `Waiting on ${beat.blockedBy.map(shortId).join(", ")}`,
    };
  }

  if (beat.state === "open") {
    return {
      readiness: "runnable",
      reason: "Ready to ship.",
    };
  }

  return {
    readiness: "blocked",
    reason: `State is ${beat.state}.`,
  };
}

function computeSummary(plan: WavePlan): WaveSummary {
  const allBeats: WaveBeat[] = [
    ...plan.waves.flatMap((wave) => [
      ...wave.beats,
      ...(wave.gate ? [wave.gate] : []),
    ]),
    ...plan.unschedulable,
  ];

  let runnable = 0;
  let inProgress = 0;
  let blocked = 0;
  let verification = 0;
  let gates = 0;

  for (const beat of allBeats) {
    if (beat.readiness === "runnable") runnable += 1;
    if (beat.readiness === "in_progress") inProgress += 1;
    if (beat.readiness === "blocked") blocked += 1;
    if (beat.readiness === "verification") verification += 1;
    if (beat.readiness === "gate") gates += 1;
  }

  return {
    total: allBeats.length,
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
      wave.beats
        .filter((beat) => beat.readiness === "runnable")
        .map((beat) => ({
          beatId: beat.id,
          title: beat.title,
          waveLevel: wave.level,
          reason: beat.readinessReason,
          priority: beat.priority,
        }))
    )
    .sort((a, b) => {
      if (a.waveLevel !== b.waveLevel) return a.waveLevel - b.waveLevel;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.beatId.localeCompare(b.beatId);
    });

  return queue.map((item) => ({
    beatId: item.beatId,
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

  // Fetch all non-closed beats
  const beatsResult = await getBackend().list({ state: "open" } as BeatListFilters, repoPath);
  const inProgressResult = await getBackend().list({ state: "in_progress" } as BeatListFilters, repoPath);
  const blockedResult = await getBackend().list({ state: "blocked" } as BeatListFilters, repoPath);

  if (!beatsResult.ok) {
    return NextResponse.json(
      { error: beatsResult.error?.message ?? "Failed to fetch beats" },
      { status: 500 }
    );
  }

  const allBeats = [
    ...(beatsResult.data ?? []),
    ...(inProgressResult.data ?? []),
    ...(blockedResult.data ?? []),
  ];

  // Deduplicate by ID
  const seen = new Set<string>();
  const beats = allBeats.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
  const finalCutIds = new Set(
    beats
      .filter((beat) => beatInFinalCut(beat, workflowsById))
      .map((beat) => beat.id),
  );

  // Fetch deps for all beats in parallel
  const depResults = await Promise.allSettled(
    beats.map((b) => getBackend().listDependencies(b.id, repoPath))
  );

  // Collect all dep edges
  const allDeps: DepEdge[] = [];
  for (const [index, result] of depResults.entries()) {
    if (result.status === "fulfilled" && result.value.ok && result.value.data) {
      for (const dep of result.value.data) {
        if (dep.dependency_type !== "blocks") continue;
        const blocker = dep.id;
        const blocked = beats[index]?.id;
        if (!blocker || !blocked) continue;
        allDeps.push({ source: blocker, target: blocked });
      }
    }
  }

  // Build WaveBeats
  const waveBeats: WaveBeat[] = beats.map((b) => {
    const blockedBy = allDeps
      .filter((d) => d.target === b.id)
      .map((d) => d.source);
    return {
      id: b.id,
      title: b.title,
      type: b.type,
      state: b.state,
      priority: b.priority,
      labels: b.labels ?? [],
      blockedBy,
      readiness: "blocked",
      readinessReason: "",
    };
  });

  const basePlan = computeWaves(waveBeats, allDeps);
  const unschedulableIds = new Set(basePlan.unschedulable.map((b) => b.id));

  for (const wave of basePlan.waves) {
    for (const beat of wave.beats) {
      const { readiness, reason } = inferReadiness(beat, false, finalCutIds.has(beat.id));
      beat.readiness = readiness;
      beat.readinessReason = reason;
      beat.waveLevel = wave.level;
    }
    if (wave.gate) {
      const { readiness, reason } = inferReadiness(wave.gate, false, finalCutIds.has(wave.gate.id));
      wave.gate.readiness = readiness;
      wave.gate.readinessReason = reason;
      wave.gate.waveLevel = wave.level;
    }
  }

  for (const beat of basePlan.unschedulable) {
    const { readiness, reason } = inferReadiness(
      beat,
      unschedulableIds.has(beat.id),
      finalCutIds.has(beat.id),
    );
    beat.readiness = readiness;
    beat.readinessReason = reason;
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
