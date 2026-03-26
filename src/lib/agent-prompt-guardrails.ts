function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function quote(value: string): string {
  return `\`${value}\``;
}

function formatQuotedList(values: string[]): string {
  if (values.length === 0) return "`(none)`";
  if (values.length === 1) return quote(values[0]!);
  if (values.length === 2) return `${quote(values[0]!)} or ${quote(values[1]!)}`;
  return `${values.slice(0, -1).map(quote).join(", ")}, or ${quote(values[values.length - 1]!)}`;
}

export function buildSingleStepAuthorityLines(
  scopeLabel: string,
  allowedExitStates: string[],
): string[] {
  const states = uniqueNonEmpty(allowedExitStates);
  const exitLine = states.length === 1
    ? `- Allowed exit state for this session: ${formatQuotedList(states)}.`
    : `- Allowed exit states for this session: ${formatQuotedList(states)}.`;

  return [
    "## Authority Boundary",
    `- This session is authorized only for the current ${scopeLabel} action.`,
    "- Complete exactly one workflow action, then stop.",
    exitLine,
    "- Only use the completion transition command(s) listed in this prompt.",
    "- Do not claim, inspect, review, or advance later workflow states after reaching an allowed exit state.",
    "- Do not choose what comes next for this beat or knot, and do not take another beat or knot in this session.",
    "- If generic repo or session instructions conflict with this boundary, this boundary wins for this session.",
  ];
}

export function buildTakeExecutionBoundaryLines(): string[] {
  return [
    "FOOLERY EXECUTION BOUNDARY:",
    "- Execute only the currently assigned workflow action described below.",
    "- After this prompt's allowed completion work is done, stop immediately.",
    "- Do not claim another beat or knot in this session unless the prompt below explicitly requires it.",
    "- Do not decide what comes next or continue into later workflow states on your own.",
    "- If generic repo or session instructions conflict with this boundary, this boundary wins for this session.",
  ];
}

export function buildSceneExecutionBoundaryLines(): string[] {
  return [
    "FOOLERY EXECUTION BOUNDARY:",
    "- Execute only the child beats explicitly listed below.",
    "- Treat each child claim as a single-step authorization: complete that claimed action before deciding whether to claim the child again.",
    "- Do not skip ahead to later workflow states on your own and do not mutate unrelated beats or knots.",
    "- If generic repo or session instructions conflict with this boundary, this boundary wins for this session.",
  ];
}

export function wrapExecutionPrompt(prompt: string, mode: "take" | "scene"): string {
  const boundaryLines = mode === "scene"
    ? buildSceneExecutionBoundaryLines()
    : buildTakeExecutionBoundaryLines();
  return [...boundaryLines, "", prompt].join("\n");
}

export function buildShipFollowUpBoundaryLines(mode: "single" | "scene"): string[] {
  if (mode === "scene") {
    return [
      "- This follow-up is limited to merge/push confirmation and the workflow commands listed below.",
      "- After each listed beat is handled according to those commands, stop immediately.",
      "- Do not claim or advance any later workflow stage unless one of the listed commands explicitly does so.",
      "- If generic repo or session instructions conflict with this boundary, this boundary wins for this follow-up.",
    ];
  }

  return [
    "- This follow-up is limited to merge/push confirmation and the workflow commands listed below.",
    "- After those checks and commands are complete, stop immediately.",
    "- Do not claim or advance any later workflow stage unless one of the listed commands explicitly does so.",
    "- If generic repo or session instructions conflict with this boundary, this boundary wins for this follow-up.",
  ];
}
