import { buildWorkflowStateCommand } from "@/lib/memory-manager-commands";
import { WorkflowStep, type WorkflowStep as WorkflowStepValue } from "@/lib/workflows";

const EXIT_STATE_BY_STEP: Readonly<Record<WorkflowStepValue, string>> = Object.freeze({
  [WorkflowStep.Planning]: "ready_for_plan_review",
  [WorkflowStep.PlanReview]: "ready_for_implementation",
  [WorkflowStep.Implementation]: "ready_for_implementation_review",
  [WorkflowStep.ImplementationReview]: "ready_for_shipment",
  [WorkflowStep.Shipment]: "ready_for_shipment_review",
  [WorkflowStep.ShipmentReview]: "shipped",
});

function transitionCommand(beatId: string, workflowState: string): string {
  return buildWorkflowStateCommand(beatId, workflowState, "beads", { noDaemon: true });
}

function invariantLines(step: WorkflowStepValue, currentState: string, beatId: string): string[] {
  return [
    "CRITICAL INVARIANT — QUEUE/TERMINAL STATE REQUIREMENT:",
    "Before ending your work, ensure the beat is in a queue state (ready_for_*) or terminal state (shipped/abandoned).",
    "Never leave work in an action state (planning, plan_review, implementation, implementation_review, shipment, shipment_review).",
    `If the beat is currently in an action state (${currentState}), run \`${transitionCommand(beatId, EXIT_STATE_BY_STEP[step])}\` before stopping.`,
  ];
}

function commonHeader(stepTitle: string, beatId: string, currentState: string, step: WorkflowStepValue): string[] {
  const quotedBeatId = JSON.stringify(beatId);
  return [
    `# ${stepTitle}`,
    "",
    "## Input",
    `- Beat ID: ${beatId}`,
    `- Current state: ${currentState}`,
    `- Inspect details with \`bd show ${quotedBeatId}\` before making changes.`,
    "",
    ...invariantLines(step, currentState, beatId),
    "",
    "## Actions",
  ];
}

function buildPlanningPrompt(beatId: string, currentState: string): string {
  const toPlanReview = transitionCommand(beatId, "ready_for_plan_review");
  return [
    ...commonHeader("Planning", beatId, currentState, WorkflowStep.Planning),
    "1. Produce or refine an implementation plan for the beat.",
    "2. Ensure the plan covers scope, risks, and verification.",
    `3. Move to plan review queue: \`${toPlanReview}\`.`,
    "4. Run `bd sync`.",
    "",
    "## Output",
    "- Planning artifacts updated in the repository.",
    "- Beat transitioned to `ready_for_plan_review`.",
  ].join("\n");
}

function buildPlanReviewPrompt(beatId: string, currentState: string): string {
  const toImplementation = transitionCommand(beatId, "ready_for_implementation");
  const toPlanning = transitionCommand(beatId, "ready_for_planning");
  return [
    ...commonHeader("Plan Review", beatId, currentState, WorkflowStep.PlanReview),
    "1. Review the planning output for completeness and feasibility.",
    `2. If approved, move to implementation queue: \`${toImplementation}\`.`,
    `3. If changes are required, send back to planning queue: \`${toPlanning}\`.`,
    "4. Run `bd sync`.",
    "",
    "## Output",
    "- Plan either approved for implementation or sent back for refinement.",
    "- Beat ends in a queue state.",
  ].join("\n");
}

function buildImplementationPrompt(beatId: string, currentState: string): string {
  const toImplementationReview = transitionCommand(beatId, "ready_for_implementation_review");
  return [
    ...commonHeader("Implementation", beatId, currentState, WorkflowStep.Implementation),
    "1. Implement the required code changes.",
    "2. Add or update tests for new behavior.",
    "3. Run project quality gates required for code changes.",
    `4. Move to implementation review queue: \`${toImplementationReview}\`.`,
    "5. Run `bd sync`.",
    "",
    "## Output",
    "- Implementation completed with tests and quality checks.",
    "- Beat transitioned to `ready_for_implementation_review`.",
  ].join("\n");
}

function buildImplementationReviewPrompt(beatId: string, currentState: string): string {
  const toShipment = transitionCommand(beatId, "ready_for_shipment");
  const toImplementation = transitionCommand(beatId, "ready_for_implementation");
  return [
    ...commonHeader("Implementation Review", beatId, currentState, WorkflowStep.ImplementationReview),
    "1. Review implementation quality, behavior, and test coverage.",
    `2. If approved, move to shipment queue: \`${toShipment}\`.`,
    `3. If revisions are needed, return to implementation queue: \`${toImplementation}\`.`,
    "4. Run `bd sync`.",
    "",
    "## Output",
    "- Review decision recorded via workflow transition.",
    "- Beat ends in a queue state.",
  ].join("\n");
}

function buildShipmentPrompt(beatId: string, currentState: string): string {
  const toShipmentReview = transitionCommand(beatId, "ready_for_shipment_review");
  return [
    ...commonHeader("Shipment", beatId, currentState, WorkflowStep.Shipment),
    "1. Ensure implementation is committed and integrated to the expected target branch.",
    "2. Verify any release or deployment prerequisites.",
    `3. Move to shipment review queue: \`${toShipmentReview}\`.`,
    "4. Run `bd sync`.",
    "",
    "## Output",
    "- Shipment work completed and queued for final review.",
    "- Beat transitioned to `ready_for_shipment_review`.",
  ].join("\n");
}

function buildShipmentReviewPrompt(beatId: string, currentState: string): string {
  const toShipped = transitionCommand(beatId, "shipped");
  const toShipment = transitionCommand(beatId, "ready_for_shipment");
  const toImplementation = transitionCommand(beatId, "ready_for_implementation");
  return [
    ...commonHeader("Shipment Review", beatId, currentState, WorkflowStep.ShipmentReview),
    "1. Confirm shipment completeness and post-ship validation.",
    `2. If approved, close as shipped: \`${toShipped}\`.`,
    `3. If shipment fixes are needed, return to shipment queue: \`${toShipment}\`.`,
    `4. If deeper fixes are needed, return to implementation queue: \`${toImplementation}\`.`,
    "5. Run `bd sync`.",
    "",
    "## Output",
    "- Beat moved to `shipped` or an appropriate queue state for follow-up.",
  ].join("\n");
}

export function getBeadsSkillPrompt(
  step: WorkflowStepValue,
  beatId: string,
  currentState: string,
): string {
  switch (step) {
    case WorkflowStep.Planning:
      return buildPlanningPrompt(beatId, currentState);
    case WorkflowStep.PlanReview:
      return buildPlanReviewPrompt(beatId, currentState);
    case WorkflowStep.Implementation:
      return buildImplementationPrompt(beatId, currentState);
    case WorkflowStep.ImplementationReview:
      return buildImplementationReviewPrompt(beatId, currentState);
    case WorkflowStep.Shipment:
      return buildShipmentPrompt(beatId, currentState);
    case WorkflowStep.ShipmentReview:
      return buildShipmentReviewPrompt(beatId, currentState);
    default:
      return buildImplementationPrompt(beatId, currentState);
  }
}
