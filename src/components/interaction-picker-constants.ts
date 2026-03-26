export type WorkflowStepFilterId =
  | "planning"
  | "plan_review"
  | "implementation"
  | "implementation_review"
  | "shipment"
  | "shipment_review";

export interface WorkflowStepFilterOption {
  id: WorkflowStepFilterId;
  label: string;
  states: readonly [string, string];
}

export const WORKFLOW_STEP_FILTERS: readonly WorkflowStepFilterOption[] = [
  {
    id: "planning",
    label: "Planning",
    states: ["ready_for_planning", "planning"],
  },
  {
    id: "plan_review",
    label: "Plan Review",
    states: ["ready_for_plan_review", "plan_review"],
  },
  {
    id: "implementation",
    label: "Implementation",
    states: ["ready_for_implementation", "implementation"],
  },
  {
    id: "implementation_review",
    label: "Implementation Review",
    states: ["ready_for_implementation_review", "implementation_review"],
  },
  {
    id: "shipment",
    label: "Shipment",
    states: ["ready_for_shipment", "shipment"],
  },
  {
    id: "shipment_review",
    label: "Shipment Review",
    states: ["ready_for_shipment_review", "shipment_review"],
  },
];

export const WORKFLOW_FILTER_BY_ID = new Map<
  WorkflowStepFilterId,
  WorkflowStepFilterOption
>(WORKFLOW_STEP_FILTERS.map((item) => [item.id, item]));

export const WORKFLOW_STATES = Array.from(
  new Set(
    WORKFLOW_STEP_FILTERS.flatMap((item) => [item.states[0], item.states[1]]),
  ),
);

export const WORKFLOW_FILTER_BY_STATE = new Map<string, WorkflowStepFilterOption>(
  WORKFLOW_STEP_FILTERS.flatMap((item) => [
    [item.states[0], item] as const,
    [item.states[1], item] as const,
  ]),
);
