import type { PoolEntry, RegisteredAgent } from "@/lib/types";
import type { AgentTarget, CliAgentTarget, OpenRouterAgentTarget } from "@/lib/types-agent-target";
import type { PoolsSettings, RegisteredAgentConfig } from "@/lib/schemas";
import type { WorkflowStep } from "@/lib/workflows";

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
  excludeAgentId?: string,
): AgentTarget | null {
  // Filter to entries that reference existing agents and have positive weight
  const valid = pool.filter(
    (entry) => entry.weight > 0 && agents[entry.agentId],
  );
  if (valid.length === 0) return null;

  // Cross-agent review: prefer agents other than the excluded one
  if (excludeAgentId) {
    const alternatives = valid.filter(
      (entry) => entry.agentId !== excludeAgentId,
    );
    if (alternatives.length > 0) {
      return selectWeighted(alternatives, agents);
    }
    // No alternative agents available; fall through to use the full pool
    console.log(
      `[agent-pool] Cross-agent review: no eligible alternative to "${excludeAgentId}" in pool, using it anyway`,
    );
  }

  return selectWeighted(valid, agents);
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
  step: WorkflowStep,
  pools: PoolsSettings,
  agents: Record<string, RegisteredAgentConfig>,
  excludeAgentId?: string,
): AgentTarget | null {
  const pool = pools[step];
  if (!pool || pool.length === 0) return null;
  return selectFromPool(pool, agents, excludeAgentId);
}

function toAgentTarget(
  reg: RegisteredAgentConfig | RegisteredAgent,
  agentId?: string,
): AgentTarget {
  if (reg.command === "openrouter-agent" && reg.model) {
    const target: OpenRouterAgentTarget = {
      kind: "openrouter",
      provider: "openrouter",
      authSource: "settings",
      model: reg.model,
      command: reg.command,
      ...(reg.version ? { version: reg.version } : {}),
      ...(reg.label ? { label: reg.label } : {}),
      ...(agentId ? { agentId } : {}),
    };
    return target;
  }

  const target: CliAgentTarget = {
    kind: "cli",
    command: reg.command,
    ...(reg.model ? { model: reg.model } : {}),
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
