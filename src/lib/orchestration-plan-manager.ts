import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { EventEmitter } from "node:events";

import {
  addEdge,
  listEdges,
  listKnots,
  newKnot,
  removeEdge,
  showKnot,
  updateKnot,
  type ExecutionPlanRecord,
  type KnotEdge,
} from "@/lib/knots";
import {
  createOrchestrationSession,
  getOrchestrationSession,
} from "@/lib/orchestration-manager";
import { createSession } from "@/lib/terminal-manager";
import { getBackend } from "@/lib/backend-instance";
import type { OrchestrationPlan } from "@/lib/types";
import type {
  CreatePlanInput,
  Plan,
  PlanStep,
} from "@/lib/orchestration-plan-types";
import {
  collectPlannedBeatIds,
  isPlanKnot,
  mapExecutionPlanRecord,
  serializePlanRecord,
  toExecutionPlanRecord,
} from "@/lib/orchestration-plan-payload";

const PLAN_TIMEOUT_MS = 3 * 60 * 1000;

async function writePlanPayloadFile(
  payload: ExecutionPlanRecord,
): Promise<string> {
  const dir = await mkdtemp(
    join(tmpdir(), "foolery-plan-"),
  );
  const filePath = join(dir, "execution-plan.json");
  await writeFile(
    filePath,
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  return filePath;
}

async function cleanupPlanPayloadFile(
  filePath: string,
): Promise<void> {
  const dirPath = filePath.replace(/\/execution-plan\.json$/u, "");
  await rm(filePath, { force: true }).catch(() => undefined);
  await rm(dirPath, {
    force: true,
    recursive: true,
  }).catch(() => undefined);
}

async function persistPlanPayload(
  planId: string,
  payload: ExecutionPlanRecord,
  repoPath: string,
): Promise<void> {
  const filePath = await writePlanPayloadFile(payload);
  try {
    const updateResult = await updateKnot(
      planId,
      { executionPlanFile: filePath },
      repoPath,
    );
    if (!updateResult.ok) {
      throw new Error(
        updateResult.error ??
          "Failed to persist execution plan payload.",
      );
    }
  } finally {
    await cleanupPlanPayloadFile(filePath);
  }
}

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

async function reconcilePlannedByEdges(
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

function buildPlanTitle(input: CreatePlanInput): string {
  const repoLabel = basename(input.repoPath);
  const objective = input.objective?.trim();
  if (objective) {
    return `Execution plan: ${objective}`;
  }
  return `Execution plan for ${repoLabel}`;
}

function listAllSteps(plan: Plan): PlanStep[] {
  return plan.waves.flatMap((wave) => wave.steps);
}

function findStep(plan: Plan, stepId: string): PlanStep | null {
  for (const wave of plan.waves) {
    const found =
      wave.steps.find((step) => step.id === stepId) ?? null;
    if (found) return found;
  }
  return null;
}

function areDependenciesComplete(
  plan: Plan,
  step: PlanStep,
): boolean {
  const byId = new Map(
    listAllSteps(plan).map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  return step.dependsOn.every((dependencyId) => {
    const dependency = byId.get(dependencyId);
    return dependency?.status === "complete";
  });
}

async function loadStoredPlan(
  planId: string,
  repoPath?: string,
): Promise<{ plan: Plan; repoPath: string }> {
  const plan = await getPlan(planId, repoPath);
  if (!plan) {
    throw new Error("Plan not found");
  }
  return {
    plan,
    repoPath: plan.repoPath || repoPath || process.cwd(),
  };
}

async function persistPlan(
  plan: Plan,
  repoPath: string,
): Promise<void> {
  const payload = serializePlanRecord(plan);
  await persistPlanPayload(plan.id, payload, repoPath);
  await reconcilePlannedByEdges(plan.id, payload, repoPath);
}

export async function createPlan(
  input: CreatePlanInput,
): Promise<{ planId: string }> {
  const session = await createOrchestrationSession(
    input.repoPath,
    input.objective,
    {
      model: input.model,
      mode: input.mode ?? "groom",
    },
  );
  const plan = await waitForSessionPlan(session.id);
  const payload = toExecutionPlanRecord(input, plan);

  const createResult = await newKnot(
    buildPlanTitle(input),
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

  await persistPlanPayload(
    createResult.data.id,
    payload,
    input.repoPath,
  );
  await reconcilePlannedByEdges(
    createResult.data.id,
    payload,
    input.repoPath,
  );
  return { planId: createResult.data.id };
}

export async function getPlan(
  planId: string,
  repoPath?: string,
): Promise<Plan | null> {
  const result = await showKnot(planId, repoPath);
  if (!result.ok) {
    if (result.error?.toLowerCase().includes("not found")) {
      return null;
    }
    throw new Error(
      result.error ?? "Failed to load execution plan.",
    );
  }

  if (!result.data || !isPlanKnot(result.data)) return null;
  return mapExecutionPlanRecord(result.data);
}

export async function listPlans(
  repoPath: string,
): Promise<Plan[]> {
  const result = await listKnots(repoPath);
  if (!result.ok) {
    throw new Error(
      result.error ?? "Failed to list execution plans.",
    );
  }

  return (result.data ?? [])
    .filter(isPlanKnot)
    .map(mapExecutionPlanRecord)
    .filter((plan): plan is Plan => Boolean(plan))
    .filter((plan) => plan.repoPath === repoPath);
}

export async function getNextPlanStep(
  planId: string,
  repoPath?: string,
): Promise<PlanStep | null> {
  const { plan } = await loadStoredPlan(planId, repoPath);
  for (const step of listAllSteps(plan)) {
    if (step.status !== "pending") continue;
    if (areDependenciesComplete(plan, step)) {
      return step;
    }
  }
  return null;
}

export async function startPlanStep(
  planId: string,
  stepId: string,
  repoPath?: string,
): Promise<{ beats: Array<{ beatId: string; sessionId: string }> }> {
  const loaded = await loadStoredPlan(planId, repoPath);
  const step = findStep(loaded.plan, stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found.`);
  }
  if (step.status !== "pending") {
    throw new Error(`Step ${stepId} is not pending.`);
  }
  if (!areDependenciesComplete(loaded.plan, step)) {
    throw new Error(
      `Step ${stepId} still has incomplete predecessors.`,
    );
  }

  step.status = "in_progress";
  step.startedAt = new Date().toISOString();
  loaded.plan.status = "active";

  const beats = await Promise.all(
    step.beatIds.map(async (beatId) => {
      const session = await createSession(
        beatId,
        loaded.repoPath,
      );
      return { beatId, sessionId: session.id };
    }),
  );

  await persistPlan(loaded.plan, loaded.repoPath);
  return { beats };
}

export async function completePlanStep(
  planId: string,
  stepId: string,
  repoPath?: string,
): Promise<{ stepId: string; status: "complete" }> {
  const loaded = await loadStoredPlan(planId, repoPath);
  const step = findStep(loaded.plan, stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found.`);
  }
  if (step.status !== "in_progress") {
    throw new Error(`Step ${stepId} is not in progress.`);
  }

  for (const beatId of step.beatIds) {
    const result = await getBackend().get(
      beatId,
      loaded.repoPath,
    );
    if (!result.ok || result.data?.state !== "shipped") {
      throw new Error(
        `Beat ${beatId} is not shipped yet.`,
      );
    }
  }

  step.status = "complete";
  step.completedAt = new Date().toISOString();
  if (listAllSteps(loaded.plan).every((item) => item.status === "complete")) {
    loaded.plan.status = "complete";
  }

  await persistPlan(loaded.plan, loaded.repoPath);
  return { stepId, status: "complete" };
}

export async function failPlanStep(
  planId: string,
  stepId: string,
  reason?: string,
  repoPath?: string,
): Promise<{ stepId: string; status: "failed" }> {
  const loaded = await loadStoredPlan(planId, repoPath);
  const step = findStep(loaded.plan, stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found.`);
  }

  step.status = "failed";
  step.failedAt = new Date().toISOString();
  step.failureReason = reason?.trim() || "Step failed";
  loaded.plan.status = "aborted";

  await persistPlan(loaded.plan, loaded.repoPath);
  return { stepId, status: "failed" };
}
