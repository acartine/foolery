import { NextRequest, NextResponse } from "next/server";
import { getBackend } from "@/lib/backend-instance";
import type { BeatListFilters } from "@/lib/backend-port";
import { computeWaves } from "@/lib/wave-planner";
import type {
  Beat,
  WaveBeat,
  WavePlan,
  WaveRecommendation,
  WaveReadiness,
  WaveSummary,
} from "@/lib/types";
import { beatInFinalCut, workflowDescriptorById } from "@/lib/workflows";
import { displayBeatLabel } from "@/lib/beat-display";

interface DepEdge {
  source: string; // blocker
  target: string; // blocked
}

function labelBeat(
  id: string,
  aliasesById: ReadonlyMap<string, readonly string[] | undefined>,
): string {
  return displayBeatLabel(id, aliasesById.get(id));
}

function inferReadiness(
  beat: WaveBeat,
  isUnschedulable: boolean,
  isInFinalCut: boolean,
  aliasesById: ReadonlyMap<string, readonly string[] | undefined>,
): { readiness: WaveReadiness; reason: string } {
  const requiresHumanAction =
    beat.requiresHumanAction
    || beat.nextActionOwnerKind === "human";

  if (isUnschedulable) {
    return {
      readiness: "unschedulable",
      reason: "Dependency cycle detected. Resolve cycle before shipping.",
    };
  }

  if (isInFinalCut || requiresHumanAction) {
    return {
      readiness: "humanAction",
      reason: requiresHumanAction && beat.type === "gate"
        ? "Awaiting human approval for this gate."
        : "Awaiting human action. Not eligible for shipping.",
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
        ? `Waiting on ${beat.blockedBy.map((id) => labelBeat(id, aliasesById)).join(", ")}`
        : "Marked blocked.",
    };
  }

  if (beat.blockedBy.length > 0) {
    return {
      readiness: "blocked",
      reason: `Waiting on ${beat.blockedBy.map((id) => labelBeat(id, aliasesById)).join(", ")}`,
    };
  }

  if (beat.isAgentClaimable) {
    return {
      readiness: "runnable",
      reason: "Ready to ship.",
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
  let humanAction = 0;
  let gates = 0;

  for (const beat of allBeats) {
    if (beat.readiness === "runnable") runnable += 1;
    if (beat.readiness === "in_progress") inProgress += 1;
    if (beat.readiness === "blocked") blocked += 1;
    if (beat.readiness === "humanAction") humanAction += 1;
    if (beat.type === "gate") gates += 1;
  }

  return {
    total: allBeats.length,
    runnable,
    inProgress,
    blocked,
    humanAction,
    gates,
    unschedulable: plan.unschedulable.length,
  };
}

function computeRunnableQueue(
  plan: WavePlan,
): WaveRecommendation[] {
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
      if (a.waveLevel !== b.waveLevel)
        return a.waveLevel - b.waveLevel;
      if (a.priority !== b.priority)
        return a.priority - b.priority;
      return a.beatId.localeCompare(b.beatId);
    });

  return queue.map((item) => ({
    beatId: item.beatId,
    title: item.title,
    waveLevel: item.waveLevel,
    reason: item.reason,
  }));
}

function collectDepEdges(
  depResults: PromiseSettledResult<
    Awaited<ReturnType<ReturnType<typeof getBackend>["listDependencies"]>>
  >[],
  beats: { id: string }[],
): DepEdge[] {
  const edges: DepEdge[] = [];
  for (const [index, result] of depResults.entries()) {
    if (
      result.status !== "fulfilled" ||
      !result.value.ok ||
      !result.value.data
    ) continue;
    for (const dep of result.value.data) {
      if (dep.dependency_type !== "blocks") continue;
      const blocker = dep.id;
      const blocked = beats[index]?.id;
      if (!blocker || !blocked) continue;
      edges.push({ source: blocker, target: blocked });
    }
  }
  return edges;
}

function buildWaveBeats(
  beats: Beat[],
  deps: DepEdge[],
): WaveBeat[] {
  return beats.map((b) => {
    const blockedBy = deps
      .filter((d) => d.target === b.id)
      .map((d) => d.source);
    return {
      id: b.id,
      aliases: b.aliases,
      title: b.title,
      type: b.type,
      state: b.state,
      nextActionOwnerKind: b.nextActionOwnerKind,
      requiresHumanAction: b.requiresHumanAction,
      isAgentClaimable: b.isAgentClaimable,
      priority: b.priority,
      labels: b.labels ?? [],
      blockedBy,
      readiness: "blocked" as const,
      readinessReason: "",
    };
  });
}

function annotateReadiness(
  plan: WavePlan,
  finalCutIds: Set<string>,
  aliasesById: ReadonlyMap<
    string, readonly string[] | undefined
  >,
): void {
  const unschedulableIds = new Set(
    plan.unschedulable.map((b) => b.id),
  );
  for (const wave of plan.waves) {
    for (const beat of wave.beats) {
      const r = inferReadiness(
        beat, false, finalCutIds.has(beat.id), aliasesById,
      );
      beat.readiness = r.readiness;
      beat.readinessReason = r.reason;
      beat.waveLevel = wave.level;
    }
    if (wave.gate) {
      const r = inferReadiness(
        wave.gate,
        false,
        finalCutIds.has(wave.gate.id),
        aliasesById,
      );
      wave.gate.readiness = r.readiness;
      wave.gate.readinessReason = r.reason;
      wave.gate.waveLevel = wave.level;
    }
  }
  for (const beat of plan.unschedulable) {
    const r = inferReadiness(
      beat,
      unschedulableIds.has(beat.id),
      finalCutIds.has(beat.id),
      aliasesById,
    );
    beat.readiness = r.readiness;
    beat.readinessReason = r.reason;
  }
}

function assembleFinalPlan(basePlan: WavePlan): WavePlan {
  const plan: WavePlan = {
    ...basePlan,
    summary: {
      total: 0, runnable: 0, inProgress: 0,
      blocked: 0, humanAction: 0, gates: 0,
      unschedulable: 0,
    },
    runnableQueue: [],
  };
  plan.summary = computeSummary(plan);
  plan.runnableQueue = computeRunnableQueue(plan);
  plan.recommendation = plan.runnableQueue[0];
  return plan;
}

export async function GET(request: NextRequest) {
  const repo =
    request.nextUrl.searchParams.get("_repo") || undefined;
  const wfResult = await getBackend().listWorkflows(repo);
  const workflowsById = workflowDescriptorById(
    wfResult.ok ? wfResult.data ?? [] : [],
  );

  const beatsResult = await getBackend().list(
    { state: "open" } as BeatListFilters, repo,
  );
  if (!beatsResult.ok) {
    return NextResponse.json(
      { error: beatsResult.error?.message ?? "Failed to fetch beats" },
      { status: 500 },
    );
  }
  const ipResult = await getBackend().list(
    { state: "in_progress" } as BeatListFilters, repo,
  );
  const blkResult = await getBackend().list(
    { state: "blocked" } as BeatListFilters, repo,
  );

  const allBeats = [
    ...(beatsResult.data ?? []),
    ...(ipResult.data ?? []),
    ...(blkResult.data ?? []),
  ];
  const seen = new Set<string>();
  const beats = allBeats.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });

  const finalCutIds = new Set(
    beats
      .filter((b) => beatInFinalCut(b, workflowsById))
      .map((b) => b.id),
  );
  const aliasesById = new Map(
    beats.map((b) => [b.id, b.aliases] as const),
  );

  const depResults = await Promise.allSettled(
    beats.map((b) =>
      getBackend().listDependencies(b.id, repo)),
  );
  const deps = collectDepEdges(depResults, beats);
  const waveBeats = buildWaveBeats(beats, deps);

  const basePlan = computeWaves(waveBeats, deps);
  annotateReadiness(basePlan, finalCutIds, aliasesById);

  return NextResponse.json({
    data: assembleFinalPlan(basePlan),
  });
}
