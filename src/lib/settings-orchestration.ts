import type { FoolerySettings } from "@/lib/schemas";
import type { ActionName } from "@/lib/types";
import type { AgentTarget } from "@/lib/types-agent-target";
import {
  isReviewStep,
  priorActionStep,
  type WorkflowStep,
} from "@/lib/workflows";
import {
  getFallbackCommand,
  toCliTarget,
} from "@/lib/settings-agent-targets";
import {
  getLastStepAgent,
  recordStepAgent,
  resolvePoolAgent,
} from "@/lib/agent-pool";

function withModelOverride(
  agent: AgentTarget,
  modelOverride?: string,
): AgentTarget {
  if (!modelOverride?.trim()) return agent;
  return {
    ...agent,
    model: modelOverride.trim(),
  };
}

export function resolveOrchestrationAgent(
  settings: FoolerySettings,
  modelOverride?: string,
): AgentTarget {
  if (settings.dispatchMode === "advanced") {
    const poolAgent = resolvePoolAgent(
      "orchestration",
      settings.pools,
      settings.agents,
    );
    if (poolAgent) {
      return withModelOverride(poolAgent, modelOverride);
    }
  }

  const sceneAgentId = settings.actions.scene ?? "";
  if (
    sceneAgentId &&
    sceneAgentId !== "default" &&
    settings.agents[sceneAgentId]
  ) {
    return withModelOverride(
      toCliTarget(
        settings.agents[sceneAgentId],
        sceneAgentId,
      ),
      modelOverride,
    );
  }

  return withModelOverride(
    toCliTarget({
      command: getFallbackCommand(settings.agents),
    }),
    modelOverride,
  );
}

function resolveStepFromPool(
  step: WorkflowStep,
  settings: FoolerySettings,
  beatId: string | undefined,
  fallbackAction: ActionName | undefined,
): AgentTarget | null {
  const poolAgents = settings.agents;

  let excludeAgentId: string | undefined;
  if (beatId && isReviewStep(step)) {
    const actionStep = priorActionStep(step);
    if (actionStep) {
      excludeAgentId = getLastStepAgent(beatId, actionStep);
    }
  }

  console.log(
    `[getStepAgent] step="${step}" ` +
      `dispatchMode="advanced" ` +
      `beatId=${beatId ?? "n/a"} ` +
      `fallbackAction=${fallbackAction ?? "n/a"} ` +
      `excludeAgentId=${excludeAgentId ?? "none"} ` +
      `registeredAgents=[${Object.keys(poolAgents).join(", ")}]`,
  );
  const poolAgent = resolvePoolAgent(
    step,
    settings.pools,
    poolAgents,
    excludeAgentId,
  );
  if (poolAgent) {
    if (beatId && poolAgent.agentId) {
      recordStepAgent(beatId, step, poolAgent.agentId);
    }
    console.log(
      `[getStepAgent] step="${step}" => pool selection: ` +
        `agentId=${poolAgent.agentId ?? "n/a"} ` +
        `kind=${poolAgent.kind} ` +
        `command=${poolAgent.command} ` +
        `model=${poolAgent.model ?? "n/a"}`,
    );
    return poolAgent;
  }
  console.log(
    `[getStepAgent] step="${step}" ` +
      `pool returned null, falling back to action mapping`,
  );
  return null;
}

export function resolveStepAgent(
  step: WorkflowStep,
  settings: FoolerySettings,
  fallbackAction?: ActionName,
  beatId?: string,
): AgentTarget {
  if (settings.dispatchMode === "advanced") {
    const result = resolveStepFromPool(
      step,
      settings,
      beatId,
      fallbackAction,
    );
    if (result) return result;
  }

  if (fallbackAction) {
    const agentId = settings.actions[fallbackAction] ?? "";
    if (
      agentId &&
      agentId !== "default" &&
      settings.agents[agentId]
    ) {
      return toCliTarget(settings.agents[agentId], agentId);
    }
  }

  return toCliTarget({
    command: getFallbackCommand(settings.agents),
  });
}
