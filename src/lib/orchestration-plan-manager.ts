import { EventEmitter } from "node:events";
import {
  addEdge,
  listEdges,
  listKnots,
  newKnot,
  removeEdge,
  showKnot,
  type ExecutionPlanRecord,
  type KnotEdge,
  type KnotRecord,
} from "@/lib/knots";
import {
  createExplicitOrchestrationSession,
  getOrchestrationSession,
} from "@/lib/orchestration-manager";
import { getBackend } from "@/lib/backend-instance";
import type { OrchestrationPlan } from "@/lib/types";
import type {
  CreatePlanInput,
  NextPlanStep,
  PlanBeatProgress,
  PlanDocument,
  PlanLineage,
  PlanProgress,
  PlanRecord,
  PlanStepProgress,
  PlanSummary,
  PlanWaveProgress,
} from "@/lib/orchestration-plan-types";
import {
  collectPlannedBeatIds,
  isPlanKnot,
  mapExecutionPlanDocument,
  mapPlanArtifact,
  mapPlanSummary,
  toExecutionPlanRecord,
} from "@/lib/orchestration-plan-payload";
import { buildExecutionPlanSkillPrompt } from "@/lib/orchestration-plan-skill-prompt";
import {
  buildPlanTitle,
  canonicalizePlanId,
  normalizeSelectedBeatIds,
  resolvePlanLookupRepos,
} from "@/lib/orchestration-plan-id-resolution";
import { persistPlanPayload } from "@/lib/orchestration-plan-storage";

const PLAN_TIMEOUT_MS = 3 * 60 * 1000;
async function waitForSessionPlan(
  sessionId: string,
): Promise<OrchestrationPlan> {
  const entry = getOrchestrationSession(sessionId);
  if (!entry) {
    throw new Error(`Session ${sessionId} not found.`);
  }

  const immediatePlan = entry.session.plan;
  if (entry.session.status !== "running") {
    if (!immediatePlan) {
      throw new Error(
        entry.session.error ??
          "Orchestration finished without a plan.",
      );
    }
    return immediatePlan;
  }

  return new Promise<OrchestrationPlan>(
    (resolve, reject) => {
      const emitter = entry.emitter as EventEmitter;
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting for orchestration plan after ${PLAN_TIMEOUT_MS}ms.`,
          ),
        );
      }, PLAN_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timer);
        emitter.off("data", onData);
      }

      function onData() {
        const current = getOrchestrationSession(sessionId);
        if (!current) {
          cleanup();
          reject(
            new Error(
              `Session ${sessionId} disappeared before plan retrieval.`,
            ),
          );
          return;
        }
        if (current.session.status === "running") return;
        cleanup();
        if (!current.session.plan) {
          reject(
            new Error(
              current.session.error ??
                "Orchestration finished without a plan.",
            ),
          );
          return;
        }
        resolve(current.session.plan);
      }

      emitter.on("data", onData);
    },
  );
}

async function reconcileProvenanceEdges(
  planId: string,
  payload: ExecutionPlanRecord,
  repoPath: string,
): Promise<void> {
  const expected = collectPlannedBeatIds(payload);
  const edgesResult = await listEdges(
    planId,
    "incoming",
    repoPath,
  );
  if (!edgesResult.ok) {
    throw new Error(
      edgesResult.error ??
        "Failed to read plan provenance edges.",
    );
  }

  const existing = (edgesResult.data ?? []).filter(
    (edge) =>
      edge.kind === "planned_by" && edge.dst === planId,
  );
  const existingSources = new Set(
    existing.map((edge) => edge.src),
  );

  await Promise.all(
    Array.from(expected)
      .filter((beatId) => !existingSources.has(beatId))
      .map((beatId) =>
        addEdge(beatId, "planned_by", planId, repoPath),
      ),
  );

  await Promise.all(
    existing
      .filter((edge) => !expected.has(edge.src))
      .map((edge: KnotEdge) =>
        removeEdge(
          edge.src,
          edge.kind,
          edge.dst,
          repoPath,
        ),
      ),
  );
}

async function assertReplacedPlanExists(
  replacesPlanId: string,
  repoPath: string,
): Promise<void> {
  const result = await showKnot(replacesPlanId, repoPath);
  if (!result.ok || !result.data) {
    throw new Error(
      `Replaced plan ${replacesPlanId} was not found.`,
    );
  }
  if (!isPlanKnot(result.data)) {
    throw new Error(
      `Knot ${replacesPlanId} is not an execution plan.`,
    );
  }
}

async function addRevisionEdge(
  planId: string,
  replacesPlanId: string | undefined,
  repoPath: string,
): Promise<void> {
  if (!replacesPlanId) return;
  if (replacesPlanId === planId) {
    throw new Error("A plan cannot replace itself.");
  }
  await assertReplacedPlanExists(replacesPlanId, repoPath);
  const addResult = await addEdge(
    planId,
    "replaces",
    replacesPlanId,
    repoPath,
  );
  if (!addResult.ok) {
    throw new Error(
      addResult.error ??
        "Failed to record plan revision lineage.",
    );
  }
}

function indexBeatTitles(
  plan: PlanDocument,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const wave of plan.waves) {
    for (const beat of wave.beats) {
      titles.set(beat.id, beat.title);
    }
  }
  return titles;
}

async function deriveProgress(
  plan: PlanDocument,
  repoPath: string,
): Promise<PlanProgress> {
  const beatTitles = indexBeatTitles(plan);
  const beatStates = await Promise.all(
    plan.beatIds.map(async (beatId) => {
      const result = await getBackend().get(beatId, repoPath);
      const state = !result.ok || !result.data
        ? "missing"
        : result.data.state;
      const title =
        result.ok && result.data
          ? result.data.title
          : beatTitles.get(beatId);
      return {
        beatId,
        title,
        state,
        satisfied: state === "shipped",
      } satisfies PlanBeatProgress;
    }),
  );

  const beatStateById = new Map(
    beatStates.map((beat) => [beat.beatId, beat]),
  );
  const satisfiedBeatIds = beatStates
    .filter((beat) => beat.satisfied)
    .map((beat) => beat.beatId);
  const remainingBeatIds = beatStates
    .filter((beat) => !beat.satisfied)
    .map((beat) => beat.beatId);

  const waves: PlanWaveProgress[] = [];
  let nextStep: NextPlanStep | null = null;

  const sortedWaves = [...plan.waves].sort(
    (left, right) => left.waveIndex - right.waveIndex,
  );
  for (const wave of sortedWaves) {
    const steps: PlanStepProgress[] = [];
    const sortedSteps = [...wave.steps].sort(
      (left, right) => left.stepIndex - right.stepIndex,
    );
    for (const step of sortedSteps) {
      const satisfiedForStep = step.beatIds.filter(
        (beatId) => beatStateById.get(beatId)?.satisfied,
      );
      const remainingForStep = step.beatIds.filter(
        (beatId) => !beatStateById.get(beatId)?.satisfied,
      );
      const complete = remainingForStep.length === 0;
      steps.push({
        waveIndex: wave.waveIndex,
        stepIndex: step.stepIndex,
        beatIds: step.beatIds,
        notes: step.notes,
        complete,
        satisfiedBeatIds: satisfiedForStep,
        remainingBeatIds: remainingForStep,
      });
      if (!complete && !nextStep) {
        nextStep = {
          waveIndex: wave.waveIndex,
          stepIndex: step.stepIndex,
          beatIds: step.beatIds,
          notes: step.notes,
        };
      }
    }

    waves.push({
      waveIndex: wave.waveIndex,
      complete: steps.every((step) => step.complete),
      steps,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    completionRule: "shipped",
    beatStates,
    satisfiedBeatIds,
    remainingBeatIds,
    nextStep,
    waves,
  };
}

async function deriveLineage(
  planId: string,
  repoPath: string,
): Promise<PlanLineage> {
  const [incoming, outgoing] = await Promise.all([
    listEdges(planId, "incoming", repoPath),
    listEdges(planId, "outgoing", repoPath),
  ]);

  if (!incoming.ok) {
    throw new Error(
      incoming.error ??
        "Failed to read incoming plan edges.",
    );
  }
  if (!outgoing.ok) {
    throw new Error(
      outgoing.error ??
        "Failed to read outgoing plan edges.",
    );
  }

  return {
    replacesPlanId: (outgoing.data ?? []).find(
      (edge) =>
        edge.kind === "replaces" && edge.src === planId,
    )?.dst,
    replacedByPlanIds: (incoming.data ?? [])
      .filter(
        (edge) =>
          edge.kind === "replaces" && edge.dst === planId,
      )
      .map((edge) => edge.src)
      .sort((left, right) => left.localeCompare(right)),
  };
}

async function loadPlanKnot(
  planId: string,
  repoPath?: string,
): Promise<KnotRecord | null> {
  if (repoPath) {
    const canonicalPlanId = canonicalizePlanId(
      planId,
      repoPath,
    );
    const result = await showKnot(
      canonicalPlanId,
      repoPath,
    );
    if (!result.ok) {
      if (
        result.error?.toLowerCase().includes("not found")
      ) {
        return null;
      }
      throw new Error(
        result.error ?? "Failed to load execution plan.",
      );
    }
    if (!result.data || !isPlanKnot(result.data)) return null;
    return result.data;
  }

  const candidateRepos = await resolvePlanLookupRepos(
    planId,
    undefined,
  );
  const matches: KnotRecord[] = [];

  for (const candidateRepo of candidateRepos) {
    const canonicalPlanId = canonicalizePlanId(
      planId,
      candidateRepo,
    );
    const result = await showKnot(
      canonicalPlanId,
      candidateRepo,
    );
    if (!result.ok) {
      if (
        result.error?.toLowerCase().includes("not found")
      ) {
        continue;
      }
      if (
        result.error?.toLowerCase().includes(
          "has no registered workflows",
        ) ||
        result.error?.toLowerCase().includes(
          "invalid workflow bundle",
        )
      ) {
        continue;
      }
      throw new Error(
        result.error ?? "Failed to load execution plan.",
      );
    }
    if (!result.data || !isPlanKnot(result.data)) continue;
    matches.push(result.data);
    if (planId.includes("-")) {
      return result.data;
    }
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Multiple plans match ${planId}; provide repoPath to disambiguate.`,
    );
  }
  return matches[0] ?? null;
}

export async function createPlan(
  input: CreatePlanInput,
): Promise<{ planId: string }> {
  const beatIds = normalizeSelectedBeatIds(input.beatIds);
  if (beatIds.length === 0) {
    throw new Error(
      "beatIds must contain at least one knot id.",
    );
  }

  const session = await createExplicitOrchestrationSession(
    input.repoPath,
    beatIds,
    input.objective,
    {
      model: input.model,
      mode: input.mode ?? "groom",
    },
  );
  const plan = await waitForSessionPlan(session.id);
  const payload = toExecutionPlanRecord(
    { ...input, beatIds },
    plan,
  );

  const createResult = await newKnot(
    buildPlanTitle({ ...input, beatIds }),
    {
      description:
        `Persisted execution plan for ${input.repoPath}`,
      type: "execution_plan",
    },
    input.repoPath,
  );
  if (!createResult.ok || !createResult.data?.id) {
    throw new Error(
      createResult.error ??
        "Failed to create execution plan knot.",
    );
  }

  const canonicalPlanId = canonicalizePlanId(
    createResult.data.id,
    input.repoPath,
  );

  await persistPlanPayload(
    canonicalPlanId,
    payload,
    input.repoPath,
  );
  await reconcileProvenanceEdges(
    canonicalPlanId,
    payload,
    input.repoPath,
  );
  await addRevisionEdge(
    canonicalPlanId,
    input.replacesPlanId,
    input.repoPath,
  );
  return { planId: canonicalPlanId };
}
export async function getPlan(
  planId: string,
  repoPath?: string,
): Promise<PlanRecord | null> {
  const record = await loadPlanKnot(planId, repoPath);
  if (!record) return null;
  const plan = mapExecutionPlanDocument(record);
  if (!plan) return null;
  const resolvedRepoPath =
    plan.repoPath || repoPath || process.cwd();
  const [progress, lineage] = await Promise.all([
    deriveProgress(plan, resolvedRepoPath),
    deriveLineage(planId, resolvedRepoPath),
  ]);
  const artifact = mapPlanArtifact(record);
  if (!artifact) {
    throw new Error("Plan record is missing execution plan data.");
  }
  return {
    artifact,
    plan,
    progress,
    lineage,
    skillPrompt: buildExecutionPlanSkillPrompt(
      artifact,
      plan,
      progress,
      lineage,
    ),
  };
}

export async function listPlans(
  repoPath: string,
): Promise<PlanSummary[]> {
  const result = await listKnots(repoPath);
  if (!result.ok) {
    throw new Error(
      result.error ?? "Failed to list execution plans.",
    );
  }

  return (result.data ?? [])
    .filter(isPlanKnot)
    .map(mapPlanSummary)
    .filter((plan): plan is PlanSummary => Boolean(plan))
    .filter((plan) => plan.plan.repoPath === repoPath);
}
