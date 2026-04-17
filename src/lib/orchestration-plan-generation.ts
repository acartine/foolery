import { getBackend } from "@/lib/backend-instance";
import { buildPrompt } from "@/lib/orchestration-plan-helpers";
import {
  normalizeSelectedBeatIds,
} from "@/lib/orchestration-plan-id-resolution";
import { runExecutionPlanPrompt } from "@/lib/orchestration-plan-generation-runner";
import type { CreatePlanInput } from "@/lib/orchestration-plan-types";
import type { Beat, OrchestrationPlan } from "@/lib/types";

interface ExecutionPlanDependencyEdge {
  blockerId: string;
  blockedId: string;
}

interface ExecutionPlanPromptContext {
  beats: Beat[];
  edges: ExecutionPlanDependencyEdge[];
  missingBeatIds: string[];
}

async function collectExecutionPlanEdges(
  repoPath: string,
  beats: Beat[],
): Promise<ExecutionPlanDependencyEdge[]> {
  const inScopeIds = new Set(
    beats.map((beat) => beat.id),
  );
  const edgeKeys = new Set<string>();
  const edges: ExecutionPlanDependencyEdge[] = [];

  const results = await Promise.all(
    beats.map((beat) =>
      getBackend().listDependencies(
        beat.id,
        repoPath,
        { type: "blocks" },
      ),
    ),
  );

  for (const result of results) {
    if (!result.ok) {
      throw new Error(
        result.error?.message ??
          "Failed to load execution-plan dependencies.",
      );
    }
    for (const dependency of result.data ?? []) {
      const blockerId = dependency.source?.trim();
      const blockedId = dependency.target?.trim();
      if (!blockerId || !blockedId) continue;
      if (
        !inScopeIds.has(blockerId) ||
        !inScopeIds.has(blockedId)
      ) {
        continue;
      }

      const edgeKey = `${blockerId}->${blockedId}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ blockerId, blockedId });
    }
  }

  edges.sort((left, right) => {
    const blocker = left.blockerId.localeCompare(
      right.blockerId,
    );
    if (blocker !== 0) return blocker;
    return left.blockedId.localeCompare(right.blockedId);
  });
  return edges;
}

export async function collectExecutionPlanPromptContext(
  repoPath: string,
  beatIds: string[],
): Promise<ExecutionPlanPromptContext> {
  const selectedBeatIds = normalizeSelectedBeatIds(
    beatIds,
  );
  const beats: Beat[] = [];
  const missingBeatIds: string[] = [];

  const results = await Promise.all(
    selectedBeatIds.map(async (beatId) => ({
      beatId,
      result: await getBackend().get(beatId, repoPath),
    })),
  );

  for (const { beatId, result } of results) {
    if (!result.ok || !result.data) {
      missingBeatIds.push(beatId);
      continue;
    }
    beats.push(result.data);
  }

  const edges =
    missingBeatIds.length > 0
      ? []
      : await collectExecutionPlanEdges(
          repoPath,
          beats,
        );

  return { beats, edges, missingBeatIds };
}

export function buildExecutionPlanPrompt(input: {
  repoPath: string;
  beats: Beat[];
  edges: ExecutionPlanDependencyEdge[];
  objective?: string;
  mode?: "scene" | "groom";
}): string {
  const scopedBeats = [...input.beats]
    .map((beat) => ({
      id: beat.id,
      title: beat.title,
      type: beat.type,
      state: beat.state,
      priority: beat.priority,
      description: beat.description,
    }))
    .sort((left, right) =>
      left.id.localeCompare(right.id),
    );

  return buildPrompt(
    input.repoPath,
    scopedBeats,
    [],
    input.edges,
    input.objective,
    input.mode ?? "groom",
  );
}

export async function generateExecutionPlan(
  input: CreatePlanInput,
): Promise<OrchestrationPlan> {
  const beatIds = normalizeSelectedBeatIds(
    input.beatIds,
  );
  if (beatIds.length === 0) {
    throw new Error(
      "beatIds must contain at least one knot id.",
    );
  }

  const context =
    await collectExecutionPlanPromptContext(
      input.repoPath,
      beatIds,
    );
  if (context.missingBeatIds.length > 0) {
    throw new Error(
      "Missing beats for execution plan generation: " +
        context.missingBeatIds.join(", "),
    );
  }

  if (context.beats.length === 0) {
    throw new Error(
      "No explicit beats provided for execution plan generation.",
    );
  }

  const prompt = buildExecutionPlanPrompt({
    repoPath: input.repoPath,
    beats: context.beats,
    edges: context.edges,
    objective: input.objective,
    mode: input.mode ?? "groom",
  });

  return runExecutionPlanPrompt({
    repoPath: input.repoPath,
    beatIds,
    beats: context.beats,
    prompt,
    model: input.model,
  });
}
