/**
 * Orchestration-agent resolution.
 *
 * Orchestration dispatches for execution-plan authoring / scene bundling use
 * the fixed pool key `orchestration`. When that pool is unconfigured or the
 * explicit `actions.scene` mapping is absent, resolution fails hard with a
 * red ANSI banner — no silent fallback to "first registered agent", which
 * historically routed every orchestration call to whichever agent happened to
 * be first in the TOML. See CLAUDE.md §"Fail Loudly, Never Silently".
 */
import type { FoolerySettings } from "@/lib/schemas";
import type { AgentTarget } from "@/lib/types-agent-target";
import { toCliTarget } from "@/lib/settings-agent-targets";
import { resolvePoolAgent } from "@/lib/agent-pool";
import {
  attachAgentRuntimeSettings,
} from "@/lib/agent-runtime-settings";
import {
  DISPATCH_FAILURE_MARKER,
  emitDispatchFailureBanner,
} from "@/lib/dispatch-pool-resolver";

const ORCHESTRATION_POOL_KEY = "orchestration";

function finalizeOrchestrationAgent(
  agent: AgentTarget,
  settings: FoolerySettings,
  modelOverride?: string,
): AgentTarget {
  return attachAgentRuntimeSettings(
    withModelOverride(agent, modelOverride),
    settings.agentRuntime,
  );
}

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
      ORCHESTRATION_POOL_KEY,
      settings.pools,
      settings.agents,
    );
    if (poolAgent) {
      return finalizeOrchestrationAgent(
        poolAgent, settings, modelOverride,
      );
    }
  }

  const sceneAgentId = settings.actions.scene ?? "";
  if (
    sceneAgentId &&
    sceneAgentId !== "default" &&
    settings.agents[sceneAgentId]
  ) {
    return finalizeOrchestrationAgent(
      toCliTarget(
        settings.agents[sceneAgentId],
        sceneAgentId,
      ),
      settings,
      modelOverride,
    );
  }

  const poolEntries = settings.pools?.[ORCHESTRATION_POOL_KEY] ?? [];
  const reason = poolEntries.length === 0
    ? "no_pool_configured"
    : "no_eligible_agent";
  emitDispatchFailureBanner({
    kind: "agent",
    beatId: "<orchestration>",
    state: "<orchestration>",
    workflowId: "<orchestration>",
    poolKey: ORCHESTRATION_POOL_KEY,
    reason,
  });
  throw new Error(
    `${DISPATCH_FAILURE_MARKER}: no orchestration agent configured ` +
    `(dispatchMode=${settings.dispatchMode}, ` +
    `pools.orchestration=${poolEntries.length}, ` +
    `actions.scene=${JSON.stringify(sceneAgentId)}). ` +
    `Configure [[pools.orchestration]] in ~/.config/foolery/settings.toml.`,
  );
}
