import type { ActionName, PoolEntry, RegisteredAgent } from "@/lib/types";
import type { AgentTarget, CliAgentTarget } from "@/lib/types-agent-target";
import type {
  ActionAgentMappings,
  PoolsSettings,
  RegisteredAgentConfig,
} from "@/lib/schemas";
import { WorkflowStep } from "@/lib/workflows";

/**
 * Select an agent from a weighted pool using weighted random selection.
 *
 * When `excludeAgentId` is provided (cross-agent review), the excluded agent
 * is removed from the candidate set. If no other valid agents remain, the
 * excluded agent is kept and a warning is logged.
 *
 * Returns null if the pool is empty or no valid agents remain after filtering.
 */
export function selectFromPool(
  pool: PoolEntry[],
  agents: Record<string, RegisteredAgentConfig>,
  excludeAgentId?: string | ReadonlySet<string>,
): AgentTarget | null {
  // Filter to entries that reference existing agents and have positive weight
  const valid = pool.filter(
    (entry) => entry.weight > 0 && agents[entry.agentId],
  );
  if (valid.length === 0) return null;

  // Cross-agent review: prefer agents other than the excluded one
  const excludedAgentIds = toExcludedAgentIds(
    excludeAgentId,
  );
  if (excludedAgentIds.size > 0) {
    const alternatives = valid.filter(
      (entry) =>
        !excludedAgentIds.has(entry.agentId),
    );
    if (alternatives.length > 0) {
      return selectWeighted(alternatives, agents);
    }
    console.log(
      `[agent-pool] No eligible alternative ` +
      `after exclusions [${[...excludedAgentIds].join(", ")}]`,
    );
    return null;
  }

  return selectWeighted(valid, agents);
}

/**
 * Strict variant of selectFromPool that returns null when no alternative
 * to the excluded agent exists, instead of falling back to the excluded agent.
 * Used for error-exit retry where re-running the same agent is not desired.
 */
export function selectFromPoolStrict(
  pool: PoolEntry[],
  agents: Record<string, RegisteredAgentConfig>,
  excludeAgentId: string | ReadonlySet<string>,
): AgentTarget | null {
  return selectFromPool(
    pool, agents, excludeAgentId,
  );
}

/**
 * Check whether an alternative agent exists for a step, strictly excluding
 * the given agent. Returns true if a different agent can be selected.
 */
export function hasAlternativeAgent(
  step: WorkflowStep,
  pools: PoolsSettings,
  agents: Record<string, RegisteredAgentConfig>,
  excludeAgentId: string,
): boolean {
  const pool = pools[step];
  if (!pool || pool.length === 0) return false;
  const valid = pool.filter(
    (entry) => entry.weight > 0 && agents[entry.agentId] && entry.agentId !== excludeAgentId,
  );
  return valid.length > 0;
}

/**
 * Weighted random selection from a pre-filtered list of pool entries.
 * Always includes the selected entry's agentId on the returned RegisteredAgent.
 */
function selectWeighted(
  valid: PoolEntry[],
  agents: Record<string, RegisteredAgentConfig>,
): AgentTarget | null {
  const totalWeight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const entry of valid) {
    roll -= entry.weight;
    if (roll <= 0) {
      const reg = agents[entry.agentId]!;
      return toAgentTarget(reg, entry.agentId);
    }
  }

  // Fallback to last valid entry (shouldn't happen due to floating point)
  const last = valid[valid.length - 1]!;
  return toAgentTarget(agents[last.agentId]!, last.agentId);
}

/**
 * Resolve an agent for a given workflow step.
 * Returns the selected agent from the pool, or null if no pool is configured.
 *
 * @param excludeAgentId - Agent ID to exclude for cross-agent review.
 */
export function resolvePoolAgent(
  step: keyof PoolsSettings,
  pools: PoolsSettings,
  agents: Record<string, RegisteredAgentConfig>,
  excludeAgentId?: string | ReadonlySet<string>,
): AgentTarget | null {
  const pool = pools[step];
  if (!pool || pool.length === 0) return null;
  return selectFromPool(pool, agents, excludeAgentId);
}

function toExcludedAgentIds(
  excludeAgentId?: string | ReadonlySet<string>,
): ReadonlySet<string> {
  if (!excludeAgentId) return new Set();
  if (typeof excludeAgentId === "string") {
    return new Set([excludeAgentId]);
  }
  return excludeAgentId;
}

/**
 * Replace one agentId in a pool with another while preserving total weight.
 * Swaps all occurrences of source agentId in a step.
 * If the replacement agent already exists, merge weights and remove source.
 * Returns the original entries when the swap cannot be applied.
 */
export function swapPoolAgent(
  entries: PoolEntry[],
  fromAgentId: string,
  toAgentId: string,
): PoolEntry[] {
  if (fromAgentId === toAgentId) return entries;
  const fromIndexes: number[] = [];
  let fromWeight = 0;
  for (const [idx, entry] of entries.entries()) {
    if (entry.agentId === fromAgentId) {
      fromIndexes.push(idx);
      fromWeight += entry.weight;
    }
  }
  if (fromIndexes.length === 0) return entries;

  const removeIndexes = new Set(fromIndexes);
  const firstFromIndex = fromIndexes[0]!;
  const toIndex = entries.findIndex((entry) => entry.agentId === toAgentId);
  if (toIndex >= 0) {
    return entries
      .map((entry, idx) =>
        idx === toIndex ? { ...entry, weight: entry.weight + fromWeight } : entry,
      )
      .filter((_, idx) => !removeIndexes.has(idx));
  }

  return entries
    .map((entry, idx) =>
      idx === firstFromIndex
        ? { ...entry, agentId: toAgentId, weight: fromWeight }
        : entry,
    )
    .filter((_, idx) => idx === firstFromIndex || !removeIndexes.has(idx));
}

const ACTION_NAMES: readonly ActionName[] = [
  "take",
  "scene",
  "breakdown",
  "scopeRefinement",
];

export interface SwapActionsAgentResult {
  affectedActions: number;
  updates: Partial<ActionAgentMappings>;
  updatedActions: ActionAgentMappings;
}

/**
 * Globally replace an action-mapped agent across all dispatch actions.
 * Returns per-action updates, affected action count, and merged mappings.
 */
export function swapActionsAgent(
  actions: ActionAgentMappings,
  fromAgentId: string,
  toAgentId: string,
): SwapActionsAgentResult {
  if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) {
    return { affectedActions: 0, updates: {}, updatedActions: actions };
  }

  const updates: Partial<ActionAgentMappings> = {};
  let affectedActions = 0;
  for (const action of ACTION_NAMES) {
    if (actions[action] !== fromAgentId) continue;
    updates[action] = toAgentId;
    affectedActions += 1;
  }

  if (affectedActions === 0) {
    return { affectedActions: 0, updates: {}, updatedActions: actions };
  }

  return {
    affectedActions,
    updates,
    updatedActions: { ...actions, ...updates },
  };
}

const DEFAULT_POOL_STEPS: ReadonlyArray<keyof PoolsSettings> = [
  WorkflowStep.Planning,
  WorkflowStep.PlanReview,
  WorkflowStep.Implementation,
  WorkflowStep.ImplementationReview,
  WorkflowStep.Shipment,
  WorkflowStep.ShipmentReview,
  "scope_refinement",
];

export interface SwapPoolsAgentResult {
  affectedEntries: number;
  affectedSteps: number;
  updates: Partial<PoolsSettings>;
  updatedPools: PoolsSettings;
}

export interface DispatchAgentOccurrences {
  affectedActions: number;
  affectedEntries: number;
  affectedSteps: number;
}

/**
 * Return source agent IDs that can be swapped globally.
 * A source is swappable when at least one different replacement agent exists.
 */
export function getSwappableSourceAgentIds(
  usedAgentIds: string[],
  availableAgentIds: string[],
): string[] {
  if (usedAgentIds.length === 0 || availableAgentIds.length === 0) return [];
  return usedAgentIds.filter((fromAgentId) =>
    availableAgentIds.some((toAgentId) => toAgentId !== fromAgentId),
  );
}

/**
 * Globally replace a pooled agent across workflow steps.
 * Returns per-step updates, affected step count, and the merged pools object.
 */
export function swapPoolsAgent(
  pools: PoolsSettings,
  fromAgentId: string,
  toAgentId: string,
): SwapPoolsAgentResult {
  if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) {
    return {
      affectedEntries: 0,
      affectedSteps: 0,
      updates: {},
      updatedPools: pools,
    };
  }

  const updates: Partial<PoolsSettings> = {};
  let affectedEntries = 0;
  let affectedSteps = 0;
  for (const step of DEFAULT_POOL_STEPS) {
    const stepEntries = pools[step];
    const entryMatches = stepEntries.filter(
      (entry) => entry.agentId === fromAgentId,
    ).length;
    if (entryMatches === 0) continue;

    const swappedEntries = swapPoolAgent(stepEntries, fromAgentId, toAgentId);
    if (swappedEntries !== stepEntries) {
      updates[step] = swappedEntries;
      affectedEntries += entryMatches;
      affectedSteps += 1;
    }
  }

  if (affectedSteps === 0) {
    return {
      affectedEntries: 0,
      affectedSteps: 0,
      updates: {},
      updatedPools: pools,
    };
  }

  return {
    affectedEntries,
    affectedSteps,
    updates,
    updatedPools: { ...pools, ...updates },
  };
}

/**
 * Count every dispatch occurrence of an agent across action mappings and pools.
 * Used by the global swap UI to preview the scope of a replacement.
 */
export function countDispatchAgentOccurrences(
  actions: ActionAgentMappings,
  pools: PoolsSettings,
  agentId: string,
): DispatchAgentOccurrences {
  if (!agentId) {
    return {
      affectedActions: 0,
      affectedEntries: 0,
      affectedSteps: 0,
    };
  }

  const affectedActions = ACTION_NAMES.reduce(
    (count, action) => count + (actions[action] === agentId ? 1 : 0),
    0,
  );

  let affectedEntries = 0;
  let affectedSteps = 0;
  for (const step of DEFAULT_POOL_STEPS) {
    const stepEntries = pools[step];
    const stepMatches = stepEntries.filter((entry) => entry.agentId === agentId).length;
    if (stepMatches === 0) continue;
    affectedEntries += stepMatches;
    affectedSteps += 1;
  }

  return {
    affectedActions,
    affectedEntries,
    affectedSteps,
  };
}

function toAgentTarget(
  reg: RegisteredAgentConfig | RegisteredAgent,
  agentId?: string,
): AgentTarget {
  const target: CliAgentTarget = {
    kind: "cli",
    command: reg.command,
    ...(reg.agent_type
      ? { agent_type: reg.agent_type }
      : {}),
    ...(reg.vendor ? { vendor: reg.vendor } : {}),
    ...(reg.provider ? { provider: reg.provider } : {}),
    ...(reg.agent_name
      ? { agent_name: reg.agent_name }
      : {}),
    ...(reg.lease_model
      ? { lease_model: reg.lease_model }
      : {}),
    ...(reg.model ? { model: reg.model } : {}),
    ...(reg.flavor ? { flavor: reg.flavor } : {}),
    ...(reg.version ? { version: reg.version } : {}),
    ...(reg.label ? { label: reg.label } : {}),
    ...(agentId ? { agentId } : {}),
  };
  return target;
}

// ── Per-beat agent tracking (in-memory) ─────────────────────

/**
 * In-memory record of which pool agent was last selected for a given
 * beat + workflow-step pair. Used to implement cross-agent review:
 * when a review step is about to start, we look up the agent that
 * executed the corresponding action step and exclude it from pool
 * selection.
 *
 * Keys are `${beatId}:${step}`, values are agentId strings.
 *
 * NOTE: This map is process-local and does not survive restarts.
 * For long-running desktop apps this covers the primary use-case
 * (take-loop continuation within a single process).
 */
const stepAgentMap = new Map<string, string>();

function stepKey(beatId: string, step: WorkflowStep): string {
  return `${beatId}:${step}`;
}

/** Record which pool agent was selected for a beat's workflow step. */
export function recordStepAgent(
  beatId: string,
  step: WorkflowStep,
  agentId: string,
): void {
  stepAgentMap.set(stepKey(beatId, step), agentId);
}

/** Look up the pool agent that last executed a given step for a beat. */
export function getLastStepAgent(
  beatId: string,
  step: WorkflowStep,
): string | undefined {
  return stepAgentMap.get(stepKey(beatId, step));
}

/** Clear tracking data (useful for testing). */
export function _resetStepAgentMap(): void {
  stepAgentMap.clear();
}
