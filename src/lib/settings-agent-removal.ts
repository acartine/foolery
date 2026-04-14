import type { FoolerySettings } from "@/lib/schemas";
import {
  swapPoolAgent,
} from "@/lib/agent-pool";
import type {
  ActionName,
  AgentRemovalActionUsage,
  AgentRemovalImpact,
  AgentRemovalPoolDecision,
  AgentRemovalPoolUsage,
  AgentRemovalRequest,
  SettingsPoolStep,
} from "@/lib/types";

const ACTION_NAMES: readonly ActionName[] = [
  "take",
  "scene",
  "breakdown",
  "scopeRefinement",
];

const POOL_STEPS: readonly SettingsPoolStep[] = [
  "orchestration",
  "planning",
  "plan_review",
  "implementation",
  "implementation_review",
  "shipment",
  "shipment_review",
  "scope_refinement",
];

function buildActionUsages(
  settings: FoolerySettings,
  agentId: string,
): AgentRemovalActionUsage[] {
  return ACTION_NAMES.flatMap((action) =>
    settings.actions[action] === agentId
      ? [{ action, requiresReplacement: true }]
      : [],
  );
}

function buildPoolUsages(
  settings: FoolerySettings,
  agentId: string,
): AgentRemovalPoolUsage[] {
  return POOL_STEPS.flatMap((step) => {
    const entries = settings.pools[step] ?? [];
    const affectedEntries = entries.filter(
      (entry) => entry.agentId === agentId,
    ).length;
    if (affectedEntries === 0) return [];

    const remainingEntries = entries.length - affectedEntries;
    return [{
      step,
      affectedEntries,
      remainingEntries,
      requiresReplacement: remainingEntries === 0,
    }];
  });
}

export function buildAgentRemovalImpact(
  settings: FoolerySettings,
  agentId: string,
): AgentRemovalImpact {
  const actionUsages = buildActionUsages(
    settings,
    agentId,
  );
  const poolUsages = buildPoolUsages(
    settings,
    agentId,
  );
  const replacementAgentIds = Object.keys(
    settings.agents,
  ).filter((candidateId) => candidateId !== agentId);
  const hasRequiredReplacement =
    actionUsages.length > 0
    || poolUsages.some(
      (usage) => usage.requiresReplacement,
    );

  return {
    agentId,
    registered: Boolean(settings.agents[agentId]),
    actionUsages,
    poolUsages,
    replacementAgentIds,
    canRemove:
      !hasRequiredReplacement
      || replacementAgentIds.length > 0,
  };
}

function validateReplacement(
  settings: FoolerySettings,
  removedAgentId: string,
  replacementAgentId: string | undefined,
  settingLabel: string,
): string {
  if (!replacementAgentId) {
    throw new Error(
      `${settingLabel} requires a replacement agent`,
    );
  }
  if (replacementAgentId === removedAgentId) {
    throw new Error(
      `${settingLabel} cannot be replaced with the same agent`,
    );
  }
  if (!settings.agents[replacementAgentId]) {
    throw new Error(
      `${settingLabel} replacement "${replacementAgentId}" is not registered`,
    );
  }
  return replacementAgentId;
}

function applyActionReplacements(
  settings: FoolerySettings,
  request: AgentRemovalRequest,
  impact: AgentRemovalImpact,
) {
  const updatedActions = { ...settings.actions };
  for (const usage of impact.actionUsages) {
    const replacementAgentId = validateReplacement(
      settings,
      request.id,
      request.actionReplacements?.[usage.action],
      `Action "${usage.action}"`,
    );
    updatedActions[usage.action] =
      replacementAgentId;
  }
  return updatedActions;
}

function applyPoolDecision(
  entries: FoolerySettings["pools"][SettingsPoolStep],
  removedAgentId: string,
  decision: AgentRemovalPoolDecision,
  replacementAgentId?: string,
) {
  if (decision.mode === "replace") {
    return swapPoolAgent(
      entries,
      removedAgentId,
      replacementAgentId!,
    );
  }
  return entries.filter(
    (entry) => entry.agentId !== removedAgentId,
  );
}

function applyPoolReplacements(
  settings: FoolerySettings,
  request: AgentRemovalRequest,
  impact: AgentRemovalImpact,
) {
  const updatedPools = { ...settings.pools };

  for (const usage of impact.poolUsages) {
    const decision =
      request.poolDecisions?.[usage.step];
    if (!decision) {
      throw new Error(
        `Pool "${usage.step}" requires an explicit removal decision`,
      );
    }

    const needsReplacement =
      usage.requiresReplacement
      || decision.mode === "replace";
    const replacementAgentId = needsReplacement
      ? validateReplacement(
        settings,
        request.id,
        decision.replacementAgentId,
        `Pool "${usage.step}"`,
      )
      : undefined;
    const nextEntries = applyPoolDecision(
      updatedPools[usage.step],
      request.id,
      decision,
      replacementAgentId,
    );

    if (nextEntries.length === 0) {
      throw new Error(
        `Pool "${usage.step}" cannot be left empty`,
      );
    }
    updatedPools[usage.step] = nextEntries;
  }

  return updatedPools;
}

export function applyAgentRemovalPlan(
  settings: FoolerySettings,
  request: AgentRemovalRequest,
): FoolerySettings {
  const impact = buildAgentRemovalImpact(
    settings,
    request.id,
  );
  if (!impact.registered) {
    return settings;
  }
  if (!impact.canRemove) {
    throw new Error(
      `Agent "${request.id}" cannot be removed because no replacement agent is available`,
    );
  }

  const nextAgents = Object.fromEntries(
    Object.entries(settings.agents).filter(
      ([agentId]) => agentId !== request.id,
    ),
  );
  if (
    impact.actionUsages.length === 0
    && impact.poolUsages.length === 0
  ) {
    return {
      ...settings,
      agents: nextAgents,
    };
  }

  return {
    ...settings,
    agents: nextAgents,
    actions: applyActionReplacements(
      settings,
      request,
      impact,
    ),
    pools: applyPoolReplacements(
      settings,
      request,
      impact,
    ),
  };
}
