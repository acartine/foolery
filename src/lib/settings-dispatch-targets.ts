import type { MemoryWorkflowDescriptor } from "@/lib/types";
import {
  DEFAULT_PROFILE_ID,
  WorkflowStep,
  builtinWorkflowDescriptors,
  builtinProfileDescriptor,
  normalizeProfileId,
} from "@/lib/workflows";

export const DISPATCH_WORKFLOW_BUNDLE_ID = "work_sdlc";

export const SHARED_DISPATCH_POOL_TARGET_IDS = [
  "orchestration",
  "scope_refinement",
] as const;

export const LEGACY_STEP_POOL_TARGET_IDS = [
  WorkflowStep.Planning,
  WorkflowStep.PlanReview,
  WorkflowStep.Implementation,
  WorkflowStep.ImplementationReview,
  WorkflowStep.Shipment,
  WorkflowStep.ShipmentReview,
] as const;

export const LEGACY_SETTINGS_POOL_TARGET_IDS = [
  ...SHARED_DISPATCH_POOL_TARGET_IDS,
  ...LEGACY_STEP_POOL_TARGET_IDS,
] as const;

export const EXECUTION_PLAN_SDLC_POOL_TARGET_IDS = [
  "design",
  "review",
  "orchestration",
] as const;

export const EXPLORE_SDLC_POOL_TARGET_IDS = ["exploration"] as const;

export const GATE_SDLC_POOL_TARGET_IDS = ["evaluating"] as const;

export type SharedDispatchPoolTargetId =
  (typeof SHARED_DISPATCH_POOL_TARGET_IDS)[number];

export type LegacyStepPoolTargetId =
  (typeof LEGACY_STEP_POOL_TARGET_IDS)[number];

export type LegacyDispatchPoolTargetId =
  (typeof LEGACY_SETTINGS_POOL_TARGET_IDS)[number]
  | (typeof EXECUTION_PLAN_SDLC_POOL_TARGET_IDS)[number]
  | (typeof EXPLORE_SDLC_POOL_TARGET_IDS)[number]
  | (typeof GATE_SDLC_POOL_TARGET_IDS)[number];

export interface DispatchPoolTargetDefinition {
  id: string;
  label: string;
  description: string;
  groupId: string;
  groupLabel: string;
  groupDescription: string;
  legacyTargetId: LegacyDispatchPoolTargetId;
  profileId?: string;
  workflowBundleId?: string;
  step?: WorkflowStep;
}

export interface DispatchPoolTargetGroupDefinition {
  id: string;
  label: string;
  description: string;
  targets: DispatchPoolTargetDefinition[];
}

const STEP_META: Record<
  LegacyDispatchPoolTargetId,
  { label: string; description: string }
> = {
  orchestration: {
    label: "Orchestration",
    description:
      "Execution plans, scenes, and other bundled orchestration runs",
  },
  planning: {
    label: "Planning",
    description: "Agent writes the implementation plan",
  },
  plan_review: {
    label: "Plan Review",
    description: "Agent reviews the plan for quality",
  },
  implementation: {
    label: "Implementation",
    description: "Agent writes the code",
  },
  implementation_review: {
    label: "Implementation Review",
    description: "Agent reviews the implementation",
  },
  shipment: {
    label: "Shipment",
    description: "Agent handles shipping and deployment",
  },
  shipment_review: {
    label: "Shipment Review",
    description: "Agent reviews the shipment",
  },
  scope_refinement: {
    label: "Scope Refinement",
    description: "Agent refines newly created beats after creation",
  },
  design: {
    label: "Design",
    description: "Agent drafts the execution plan",
  },
  review: {
    label: "Review",
    description: "Agent reviews the execution plan",
  },
  exploration: {
    label: "Exploration",
    description: "Agent explores the problem space",
  },
  evaluating: {
    label: "Evaluating",
    description: "Agent evaluates a gate condition",
  },
};

const WORKFLOW_STEP_ORDER: readonly WorkflowStep[] = [
  WorkflowStep.Planning,
  WorkflowStep.PlanReview,
  WorkflowStep.Implementation,
  WorkflowStep.ImplementationReview,
  WorkflowStep.Shipment,
  WorkflowStep.ShipmentReview,
];

const SHARED_GROUPS: ReadonlyArray<DispatchPoolTargetGroupDefinition> = [
  {
    id: "shared__orchestration",
    label: "Execution Planning",
    description:
      "Shared bundled orchestration targets used before beat-level take execution",
    targets: [{
      id: "orchestration",
      label: STEP_META.orchestration.label,
      description: STEP_META.orchestration.description,
      groupId: "shared__orchestration",
      groupLabel: "Execution Planning",
      groupDescription:
        "Shared bundled orchestration targets used before beat-level take execution",
      legacyTargetId: "orchestration",
    }],
  },
  {
    id: "shared__scope_refinement",
    label: "Scope Refinement",
    description:
      "Shared bundled refinement targets used after beat creation",
    targets: [{
      id: "scope_refinement",
      label: STEP_META.scope_refinement.label,
      description: STEP_META.scope_refinement.description,
      groupId: "shared__scope_refinement",
      groupLabel: "Scope Refinement",
      groupDescription:
        "Shared bundled refinement targets used after beat creation",
      legacyTargetId: "scope_refinement",
    }],
  },
];

function availableWorkflowSteps(
  workflow: MemoryWorkflowDescriptor,
): WorkflowStep[] {
  const resolvedSteps = new Set<WorkflowStep>();
  for (const state of workflow.states) {
    const resolved = resolveWorkflowStep(state);
    if (resolved) {
      resolvedSteps.add(resolved);
    }
  }
  return WORKFLOW_STEP_ORDER.filter((step) => resolvedSteps.has(step));
}

function resolveWorkflowStep(state: string): WorkflowStep | null {
  switch (state) {
    case "ready_for_planning":
    case "planning":
      return WorkflowStep.Planning;
    case "ready_for_plan_review":
    case "plan_review":
      return WorkflowStep.PlanReview;
    case "ready_for_implementation":
    case "implementation":
      return WorkflowStep.Implementation;
    case "ready_for_implementation_review":
    case "implementation_review":
      return WorkflowStep.ImplementationReview;
    case "ready_for_shipment":
    case "shipment":
      return WorkflowStep.Shipment;
    case "ready_for_shipment_review":
    case "shipment_review":
      return WorkflowStep.ShipmentReview;
    default:
      return null;
  }
}

export function buildWorkflowDispatchPoolTargetId(
  workflowBundleId: string,
  profileId: string,
  step: WorkflowStep,
): string {
  return [workflowBundleId, profileId, step].join("__");
}

export function parseWorkflowDispatchPoolTargetId(
  targetId: string,
): { workflowBundleId: string; profileId: string; step: WorkflowStep } | null {
  const parts = targetId.split("__");
  if (parts.length !== 3) return null;
  const [workflowBundleId, profileId, step] = parts;
  if (!workflowBundleId || !profileId || !WORKFLOW_STEP_ORDER.includes(step as WorkflowStep)) {
    return null;
  }
  return {
    workflowBundleId,
    profileId,
    step: step as WorkflowStep,
  };
}

function buildWorkflowGroupDefinition(
  workflow: MemoryWorkflowDescriptor,
): DispatchPoolTargetGroupDefinition {
  const steps = availableWorkflowSteps(workflow);
  const groupId = `${DISPATCH_WORKFLOW_BUNDLE_ID}__${workflow.id}`;
  const groupDescription =
    `${workflow.label} bundled workflow targets`;
  return {
    id: groupId,
    label: workflow.label,
    description: groupDescription,
    targets: steps.map((step) => ({
      id: buildWorkflowDispatchPoolTargetId(
        DISPATCH_WORKFLOW_BUNDLE_ID,
        workflow.id,
        step,
      ),
      label: STEP_META[step].label,
      description: STEP_META[step].description,
      groupId,
      groupLabel: workflow.label,
      groupDescription,
      legacyTargetId: step,
      workflowBundleId: DISPATCH_WORKFLOW_BUNDLE_ID,
      profileId: workflow.id,
      step,
    })),
  };
}

export function bundledDispatchPoolGroups(): DispatchPoolTargetGroupDefinition[] {
  return [
    ...SHARED_GROUPS,
    ...builtinWorkflowDescriptors().map(buildWorkflowGroupDefinition),
  ];
}

function buildLegacyTarget(
  id: LegacyDispatchPoolTargetId,
  groupId: string,
  groupLabel: string,
  groupDescription: string,
): DispatchPoolTargetDefinition {
  return {
    id,
    label: STEP_META[id].label,
    description: STEP_META[id].description,
    groupId,
    groupLabel,
    groupDescription,
    legacyTargetId: id,
  };
}

const KNOTS_SDLC_DESCRIPTION =
  "Beat delivery: plan, review, implement, review, ship, review";
const EXECUTION_PLAN_DESCRIPTION =
  "Authoring and orchestrating an execution plan";
const EXPLORATION_DESCRIPTION =
  "Open-ended exploration of a problem space";
const GATE_DESCRIPTION =
  "Read-only evaluation of a gate condition";

function buildGroup(
  id: string,
  label: string,
  description: string,
  actionIds: ReadonlyArray<LegacyDispatchPoolTargetId>,
): DispatchPoolTargetGroupDefinition {
  return {
    id,
    label,
    description,
    targets: actionIds.map((actionId) =>
      buildLegacyTarget(actionId, id, label, description),
    ),
  };
}

const DISPATCH_WORKFLOW_GROUPS: ReadonlyArray<DispatchPoolTargetGroupDefinition> = [
  buildGroup(
    "work_sdlc",
    "Knots SDLC",
    KNOTS_SDLC_DESCRIPTION,
    LEGACY_STEP_POOL_TARGET_IDS,
  ),
  buildGroup(
    "execution_plan_sdlc",
    "Execution Plan",
    EXECUTION_PLAN_DESCRIPTION,
    EXECUTION_PLAN_SDLC_POOL_TARGET_IDS,
  ),
  buildGroup(
    "explore_sdlc",
    "Exploration",
    EXPLORATION_DESCRIPTION,
    EXPLORE_SDLC_POOL_TARGET_IDS,
  ),
  buildGroup(
    "gate_sdlc",
    "Gate",
    GATE_DESCRIPTION,
    GATE_SDLC_POOL_TARGET_IDS,
  ),
];

export function dispatchWorkflowGroups(): DispatchPoolTargetGroupDefinition[] {
  return DISPATCH_WORKFLOW_GROUPS.map((group) => ({
    ...group,
    targets: group.targets.map((target) => ({ ...target })),
  }));
}

export function scopeRefinementDispatchTarget(): DispatchPoolTargetDefinition {
  return buildLegacyTarget(
    "scope_refinement",
    "scope_refinement",
    "Scope Refinement",
    STEP_META.scope_refinement.description,
  );
}

export function dispatchWorkflowPoolTargets(): DispatchPoolTargetDefinition[] {
  return dispatchWorkflowGroups().flatMap((group) => group.targets);
}

export function bundledWorkflowDispatchPoolTargets(): DispatchPoolTargetDefinition[] {
  return bundledDispatchPoolGroups()
    .filter((group) => !group.id.startsWith("shared__"))
    .flatMap((group) => group.targets);
}

export function allDispatchPoolTargets(): DispatchPoolTargetDefinition[] {
  return bundledDispatchPoolGroups().flatMap((group) => group.targets);
}

export function dispatchPoolTargetLabel(targetId: string): string {
  const direct = STEP_META[targetId as LegacyDispatchPoolTargetId];
  if (direct) return direct.label;
  const parsed = parseWorkflowDispatchPoolTargetId(targetId);
  if (!parsed) return targetId;
  return STEP_META[parsed.step].label;
}

export function dispatchPoolTargetGroupLabel(targetId: string): string {
  if (targetId === "orchestration") return "Execution Planning";
  if (targetId === "scope_refinement") return "Scope Refinement";
  const parsed = parseWorkflowDispatchPoolTargetId(targetId);
  if (!parsed) return "Workflow Pools";
  return builtinProfileDescriptor(parsed.profileId).label;
}

export function dispatchPoolTargetDescription(targetId: string): string {
  const direct = STEP_META[targetId as LegacyDispatchPoolTargetId];
  if (direct) return direct.description;
  const parsed = parseWorkflowDispatchPoolTargetId(targetId);
  if (!parsed) return targetId;
  return STEP_META[parsed.step].description;
}

export function workflowAwarePoolTargetIdsForStep(
  step: WorkflowStep,
  workflowOrProfileId?: string | null,
): string[] {
  const legacyTargetId = step;
  const normalized =
    normalizeProfileId(workflowOrProfileId) ?? null;
  if (!normalized) return [legacyTargetId];

  const workflow = builtinProfileDescriptor(normalized);
  if (workflow.id === DEFAULT_PROFILE_ID && normalized !== DEFAULT_PROFILE_ID) {
    return [legacyTargetId];
  }

  const exactTargetId = buildWorkflowDispatchPoolTargetId(
    DISPATCH_WORKFLOW_BUNDLE_ID,
    workflow.id,
    step,
  );
  return exactTargetId === legacyTargetId
    ? [legacyTargetId]
    : [exactTargetId, legacyTargetId];
}
