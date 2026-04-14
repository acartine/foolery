import type {
  PromptDependencyEdge,
  OrchestrationSessionEntry,
} from "@/lib/orchestration-internals";
import { buildPrompt, derivePromptScope, pushEvent } from "@/lib/orchestration-internals";
import type { Beat } from "@/lib/types";

export function emitPromptLog(
  entry: OrchestrationSessionEntry,
  beats: Beat[],
  edges: PromptDependencyEdge[],
  repoPath: string,
  objective: string | undefined,
  mode: "scene" | "groom" = "groom",
): string {
  const scope = derivePromptScope(beats, objective);
  const scopedIds = new Set(
    scope.scopedBeats.map((beat) => beat.id),
  );
  const promptEdges =
    scopedIds.size > 0
      ? edges.filter(
          (edge) =>
            scopedIds.has(edge.blockerId) &&
            scopedIds.has(edge.blockedId),
        )
      : edges;
  const prompt = buildPrompt(
    repoPath,
    scope.scopedBeats,
    scope.unresolvedScopeIds,
    promptEdges,
    objective,
    mode,
  );
  entry.interactionLog.logPrompt(prompt);
  const scopeSummary =
    scope.scopedBeats.length > 0
      ? scope.scopedBeats.map((beat) => beat.id).join(", ")
      : "inferred from objective";
  pushEvent(entry, "log", [
    "prompt_initial | Orchestration prompt sent",
    `scope | ${scopeSummary}`,
    scope.unresolvedScopeIds.length > 0
      ? `scope_unresolved | ${scope.unresolvedScopeIds.join(", ")}`
      : "",
    objective?.trim()
      ? `objective | ${objective.trim()}`
      : "",
    `mode | ${mode}`,
    promptEdges.length > 0
      ? `edges | ${promptEdges.length}`
      : "",
    "",
  ].filter(Boolean).join("\n"));
  return prompt;
}
