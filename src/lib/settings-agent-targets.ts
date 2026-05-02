/**
 * `getFallbackCommand` used to live here and returned the first registered
 * agent's command as a silent fallback. That pattern was the root cause of
 * the "all gate dispatches land on OpenCode" bug — whichever agent happened
 * to be first in the TOML got every unrouted dispatch. It was deleted.
 * See CLAUDE.md §"Fail Loudly, Never Silently".
 *
 * `toCliTarget` is a pure pass-through read. The `agent` argument is
 * already canonical — it comes from `settings.agents` (set at write time
 * by `normalizeRegisteredAgentConfig`) or from a freshly-registered
 * `RegisteredAgent` (also normalised at the registration boundary). No
 * re-derivation runs here. See `docs/knots-agent-identity-contract.md`
 * § "Sanctioned exceptions".
 */
import type { RegisteredAgentConfig } from "@/lib/schemas";
import type { RegisteredAgent } from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";

export function toCliTarget(
  agent: RegisteredAgentConfig | RegisteredAgent,
  agentId?: string,
): CliAgentTarget {
  return {
    kind: "cli",
    command: agent.command,
    ...(agent.agent_type
      ? { agent_type: agent.agent_type }
      : {}),
    ...(agent.vendor ? { vendor: agent.vendor } : {}),
    ...(agent.provider
      ? { provider: agent.provider }
      : {}),
    ...(agent.agent_name
      ? { agent_name: agent.agent_name }
      : {}),
    ...(agent.lease_model
      ? { lease_model: agent.lease_model }
      : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.flavor ? { flavor: agent.flavor } : {}),
    ...(agent.version
      ? { version: agent.version }
      : {}),
    ...(agent.approvalMode
      ? { approvalMode: agent.approvalMode }
      : {}),
    ...(agent.label ? { label: agent.label } : {}),
    ...(agentId ? { agentId } : {}),
  };
}
