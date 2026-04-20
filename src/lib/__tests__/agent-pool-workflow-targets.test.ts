import { describe, expect, it } from "vitest";
import { resolvePoolAgent } from "@/lib/agent-pool";
import { buildWorkflowDispatchPoolTargetId } from "@/lib/settings-dispatch-targets";
import type {
  PoolsSettings,
  RegisteredAgentConfig,
} from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

const AGENTS: Record<string, RegisteredAgentConfig> = {
  claude: { command: "claude", model: "opus", label: "Claude Opus" },
  sonnet: { command: "claude", model: "sonnet-4", label: "Claude Sonnet" },
  codex: { command: "codex", model: "5.3", label: "Codex" },
};

const EMPTY_POOLS: PoolsSettings = {
  orchestration: [],
  planning: [],
  plan_review: [],
  implementation: [],
  implementation_review: [],
  shipment: [],
  shipment_review: [],
  scope_refinement: [],
};

describe("resolvePoolAgent workflow targets", () => {
  it("prefers workflow-specific targets before falling back to legacy steps", () => {
    const workflowTargetId = buildWorkflowDispatchPoolTargetId(
      "work_sdlc",
      "autopilot",
      WorkflowStep.Implementation,
    );
    const pools: PoolsSettings = {
      ...EMPTY_POOLS,
      implementation: [{ agentId: "claude", weight: 1 }],
      [workflowTargetId]: [{ agentId: "codex", weight: 1 }],
    };

    const result = resolvePoolAgent(
      workflowTargetId,
      pools,
      AGENTS,
      undefined,
      [WorkflowStep.Implementation],
    );

    expect(result?.agentId).toBe("codex");
  });

  it("falls back to legacy step pools when no workflow-specific target exists", () => {
    const workflowTargetId = buildWorkflowDispatchPoolTargetId(
      "work_sdlc",
      "autopilot_with_pr",
      WorkflowStep.PlanReview,
    );
    const pools: PoolsSettings = {
      ...EMPTY_POOLS,
      plan_review: [{ agentId: "sonnet", weight: 1 }],
    };

    const result = resolvePoolAgent(
      workflowTargetId,
      pools,
      AGENTS,
      undefined,
      [WorkflowStep.PlanReview],
    );

    expect(result?.agentId).toBe("sonnet");
  });
});
