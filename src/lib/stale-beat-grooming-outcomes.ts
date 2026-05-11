import { getBackend } from "@/lib/backend-instance";
import type {
  StaleBeatGroomingJob,
} from "@/lib/stale-beat-grooming-queue";
import type {
  StaleBeatGroomingResult,
} from "@/lib/stale-beat-grooming-types";

export async function applyStaleBeatGroomingOutcome(input: {
  job: StaleBeatGroomingJob;
  result: StaleBeatGroomingResult;
}): Promise<void> {
  const { job, result } = input;
  const capsule = buildStaleBeatGroomingHandoffCapsule({
    job,
    result,
  });
  const update = await getBackend().update(
    job.beatId,
    {
      ...reshapePatch(result),
      addHandoffCapsule: capsule,
    },
    job.repoPath,
  );
  if (!update.ok) {
    throw new Error(`failed to apply stale grooming update: ${
      backendErrorMessage(update.error)
    }`);
  }

  if (result.decision !== "drop") return;
  const abandon = await getBackend().markTerminal(
    job.beatId,
    "abandoned",
    "Stale grooming decision: drop",
    job.repoPath,
  );
  if (!abandon.ok) {
    throw new Error(`failed to abandon stale beat: ${
      backendErrorMessage(abandon.error)
    }`);
  }
}

export function buildStaleBeatGroomingHandoffCapsule(input: {
  job: StaleBeatGroomingJob;
  result: StaleBeatGroomingResult;
}): string {
  const { job, result } = input;
  return [
    "Stale grooming handoff",
    "",
    "Beat was groomed because it was stale.",
    `Decision: ${result.decision}`,
    `Rationale: ${result.rationale}`,
    `Agent: ${job.agentId ?? "(default)"}`,
    `Job: ${job.id}`,
    ...(job.repoPath ? [`Repo: ${job.repoPath}`] : []),
    ...suggestedLines(result),
    ...appliedLines(result),
  ].join("\n");
}

function reshapePatch(
  result: StaleBeatGroomingResult,
): {
  title?: string;
  description?: string;
  acceptance?: string;
} {
  if (result.decision !== "reshape") return {};
  return {
    ...(nonBlank(result.suggestedTitle)
      ? { title: result.suggestedTitle.trim() }
      : {}),
    ...(nonBlank(result.suggestedDescription)
      ? { description: result.suggestedDescription.trim() }
      : {}),
    ...(nonBlank(result.suggestedAcceptance)
      ? { acceptance: result.suggestedAcceptance.trim() }
      : {}),
  };
}

function suggestedLines(result: StaleBeatGroomingResult): string[] {
  return [
    ...(nonBlank(result.suggestedTitle)
      ? [`Suggested title: ${result.suggestedTitle.trim()}`]
      : []),
    ...(nonBlank(result.suggestedDescription)
      ? [`Suggested description: ${result.suggestedDescription.trim()}`]
      : []),
    ...(nonBlank(result.suggestedAcceptance)
      ? [`Suggested acceptance: ${result.suggestedAcceptance.trim()}`]
      : []),
  ];
}

function appliedLines(result: StaleBeatGroomingResult): string[] {
  if (result.decision === "still_do") {
    return ["Action: acknowledged only; no beat fields changed."];
  }
  if (result.decision === "drop") {
    return ["Action: marked abandoned."];
  }
  const applied = Object.keys(reshapePatch(result));
  return [
    `Applied reshape fields: ${
      applied.length > 0 ? applied.join(", ") : "(none)"
    }`,
  ];
}

function nonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function backendErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown";
}
