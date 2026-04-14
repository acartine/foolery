import type {
  PlanArtifact,
  PlanDocument,
  PlanLineage,
  PlanProgress,
} from "@/lib/orchestration-plan-types";

function formatWaveStepLine(
  waveIndex: number,
  stepIndex: number,
  beatIds: string[],
): string {
  const joined =
    beatIds.length > 0
      ? beatIds.map((beatId) => `\`${beatId}\``).join(", ")
      : "`(no beats)`";
  return `- Wave ${waveIndex}, Step ${stepIndex}: ${joined}`;
}

function buildPromptInputLines(
  artifact: PlanArtifact,
  plan: PlanDocument,
): string[] {
  const objective = plan.objective?.trim();
  return [
    "## Input",
    `- Plan ID: ${artifact.id}`,
    `- Repo: ${plan.repoPath || "(unknown)"}`,
    `- Summary: ${plan.summary}`,
    objective ? `- Objective: ${objective}` : undefined,
    "- Read the immutable structure from the response `plan` field.",
    "- Read the live derived status from the response `progress` field.",
  ].filter((line): line is string => Boolean(line));
}

function buildAuthorityBoundaryLines(): string[] {
  return [
    "## Authority Boundary",
    "- Execute only the beats listed in `plan.beatIds`.",
    "- Do not widen scope by scanning the repository or inferring extra knots.",
    "- If scope changes, create a new immutable revision with `POST /api/plans` and explicit `beatIds[]`.",
  ];
}

function buildExecutionRuleLines(
  refreshPath: string,
): string[] {
  return [
    "## Execution Rules",
    "- Execute every beat in the same step in parallel when practical.",
    "- Start beat work with `POST /api/terminal`.",
    "- Use body `{ \"beatId\": \"<beat-id>\", \"_repo\": \"<repo-path>\" }` for each beat session.",
    "- Execute steps in a wave in order unless step notes explicitly say otherwise.",
    "- Execute waves in order unless wave notes explicitly say otherwise.",
    "- Treat a wave as complete only when every beat in every step is `shipped`.",
    "- When a wave completes, report the milestone to the operator or assistant channel.",
    "- Do not mutate the plan document to store execution status.",
    `- Refresh plan status with \`GET ${refreshPath}\` before choosing the next step.`,
  ];
}

function buildPlanShapeLines(
  plan: PlanDocument,
): string[] {
  const waveLines = plan.waves.flatMap((wave) => {
    const milestone =
      `- Wave ${wave.waveIndex}: ${wave.name}` +
      ` - ${wave.objective}`;
    return [
      milestone,
      ...wave.steps.map((step) =>
        formatWaveStepLine(
          wave.waveIndex,
          step.stepIndex,
          step.beatIds,
        ),
      ),
    ];
  });
  return [
    "## Plan Shape",
    ...(waveLines.length > 0
      ? waveLines
      : ["- No waves were generated for this plan."]),
  ];
}

function buildCurrentFocusLines(
  plan: PlanDocument,
  progress: PlanProgress,
  lineage: PlanLineage,
): string[] {
  const nextStepLine = progress.nextStep
    ? [
        `- Derived next step: Wave ${progress.nextStep.waveIndex},`,
        `Step ${progress.nextStep.stepIndex}:`,
        progress.nextStep.beatIds
          .map((beatId) => `\`${beatId}\``)
          .join(", "),
      ].join(" ")
    : "- Derived next step: `(none)`";
  const remainingLine =
    progress.remainingBeatIds.length > 0
      ? [
          "- Remaining beats:",
          progress.remainingBeatIds
            .map((beatId) => `\`${beatId}\``)
            .join(", "),
        ].join(" ")
      : "- Remaining beats: `(none)`";
  const unassignedLine =
    plan.unassignedBeatIds.length > 0
      ? [
          "- Unassigned beats require replanning:",
          plan.unassignedBeatIds
            .map((beatId) => `\`${beatId}\``)
            .join(", "),
        ].join(" ")
      : "- `plan.unassignedBeatIds` is empty.";
  const lineageParts: string[] = [];
  if (lineage.replacesPlanId) {
    lineageParts.push(`replaces \`${lineage.replacesPlanId}\``);
  }
  if (lineage.replacedByPlanIds.length > 0) {
    lineageParts.push(
      `replaced by ${lineage.replacedByPlanIds.map((id) => `\`${id}\``).join(", ")}`,
    );
  }
  const lineageLine =
    lineageParts.length > 0
      ? `- Revision lineage: ${lineageParts.join("; ")}`
      : "- Revision lineage: none";
  return [
    "## Current Focus",
    nextStepLine,
    remainingLine,
    unassignedLine,
    lineageLine,
  ];
}

export function buildExecutionPlanSkillPrompt(
  artifact: PlanArtifact,
  plan: PlanDocument,
  progress: PlanProgress,
  lineage: PlanLineage,
): string {
  const refreshPath =
    `/api/plans/${artifact.id}?repoPath=` +
    encodeURIComponent(plan.repoPath);

  return [
    "# Execution Plan Skill",
    "",
    ...buildPromptInputLines(artifact, plan),
    "",
    ...buildAuthorityBoundaryLines(),
    "",
    "## Taxonomy",
    "- Beat: a single knot in the plan.",
    "- Step: a set of beats that may be executed in parallel.",
    "- Wave: a sequential milestone made of one or more steps.",
    "- Plan: an immutable document; execution progress is derived live.",
    "",
    ...buildExecutionRuleLines(refreshPath),
    "",
    ...buildPlanShapeLines(plan),
    "",
    ...buildCurrentFocusLines(plan, progress, lineage),
    "",
    "## Output",
    "- Use the immutable `plan` field as the source of structure.",
    "- Use the derived `progress` field as the source of current completion state.",
    "- Only a knot state of `shipped` satisfies a beat for this plan.",
  ].join("\n");
}
