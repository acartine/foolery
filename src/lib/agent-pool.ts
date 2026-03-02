import type { RegisteredAgent, PoolEntry } from "@/lib/types";
import type { PoolsSettings, RegisteredAgentConfig } from "@/lib/schemas";
import type { WorkflowStep } from "@/lib/workflows";

/**
 * Select an agent from a weighted pool using weighted random selection.
 * Returns null if the pool is empty or no valid agents remain after filtering.
 */
export function selectFromPool(
  pool: PoolEntry[],
  agents: Record<string, RegisteredAgentConfig>,
): RegisteredAgent | null {
  // Filter to entries that reference existing agents and have positive weight
  const valid = pool.filter(
    (entry) => entry.weight > 0 && agents[entry.agentId],
  );
  if (valid.length === 0) return null;

  const totalWeight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const entry of valid) {
    roll -= entry.weight;
    if (roll <= 0) {
      const reg = agents[entry.agentId]!;
      return { command: reg.command, model: reg.model, label: reg.label };
    }
  }

  // Fallback to last valid entry (shouldn't happen due to floating point)
  const last = valid[valid.length - 1]!;
  const reg = agents[last.agentId]!;
  return { command: reg.command, model: reg.model, label: reg.label };
}

/**
 * Resolve an agent for a given workflow step.
 * Returns the selected agent from the pool, or null if no pool is configured.
 */
export function resolvePoolAgent(
  step: WorkflowStep,
  pools: PoolsSettings,
  agents: Record<string, RegisteredAgentConfig>,
): RegisteredAgent | null {
  const pool = pools[step];
  if (!pool || pool.length === 0) return null;
  return selectFromPool(pool, agents);
}
