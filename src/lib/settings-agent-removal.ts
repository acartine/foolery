import type { FoolerySettings, PoolEntry } from "@/lib/schemas";
import {
  listDispatchPoolUsages,
  swapPoolAgent,
} from "@/lib/agent-pool";
import type {
  ActionName,
  AgentRemovalActionUsage,
  AgentRemovalImpact,
  AgentRemovalPoolDecision,
  AgentRemovalPoolUsage,
  AgentRemovalRequest,
} from "@/lib/types";

const ACTION_NAMES: readonly ActionName[] = [
  "take",
  "scene",
  "breakdown",
  "scopeRefinement",
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
  return listDispatchPoolUsages(settings.pools).flatMap((usage) => {
    const entries = usage.entries;
    const affectedEntries = entries.filter(
      (entry) => entry.agentId === agentId,
    ).length;
    if (affectedEntries === 0) return [];

    const remainingEntries = entries.length - affectedEntries;
    return [{
      targetId: usage.targetId,
      targetLabel: usage.targetLabel,
      targetGroupLabel: usage.targetGroupLabel,
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
  entries: PoolEntry[] | undefined,
  removedAgentId: string,
  decision: AgentRemovalPoolDecision,
  replacementAgentId?: string,
) {
  const currentEntries = entries ?? [];
  if (decision.mode === "replace") {
    return swapPoolAgent(
      currentEntries,
      removedAgentId,
      replacementAgentId!,
    );
  }
  return currentEntries.filter(
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
      request.poolDecisions?.[usage.targetId];
    if (!decision) {
      throw new Error(
        `Pool "${usage.targetLabel}" requires an explicit removal decision`,
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
        `Pool "${usage.targetLabel}"`,
      )
      : undefined;
    const nextEntries = applyPoolDecision(
      updatedPools[usage.targetId] ?? [],
      request.id,
      decision,
      replacementAgentId,
    );

    if (nextEntries.length === 0) {
      throw new Error(
        `Pool "${usage.targetLabel}" cannot be left empty`,
      );
    }
    updatedPools[usage.targetId] = nextEntries;
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
