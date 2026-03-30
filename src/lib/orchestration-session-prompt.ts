import type {
  OrchestrationSessionEntry,
} from "@/lib/orchestration-internals";
import { buildPrompt, derivePromptScope, pushEvent } from "@/lib/orchestration-internals";
import type { Beat } from "@/lib/types";

export function emitPromptLog(
  entry: OrchestrationSessionEntry,
  beats: Beat[],
  repoPath: string,
  objective: string | undefined,
): string {
  const scope = derivePromptScope(beats, objective);
  const prompt = buildPrompt(
    repoPath,
    scope.scopedBeats,
    scope.unresolvedScopeIds,
    objective,
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
    "",
  ].filter(Boolean).join("\n"));
  return prompt;
}
