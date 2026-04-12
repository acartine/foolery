import type { RegisteredAgentConfig } from "@/lib/schemas";
import type { RegisteredAgent } from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  formatAgentDisplayLabel,
  normalizeAgentIdentity,
} from "@/lib/agent-identity";

export function getFallbackCommand(
  agents: Record<string, RegisteredAgentConfig>,
): string {
  const first = Object.values(agents)[0];
  return first?.command ?? "claude";
}

export function toCliTarget(
  agent: RegisteredAgentConfig | RegisteredAgent,
  agentId?: string,
): CliAgentTarget {
  const normalized = normalizeAgentIdentity(agent);
  return {
    kind: "cli",
    command: agent.command,
    ...(agent.agent_type
      ? { agent_type: agent.agent_type }
      : {}),
    ...(agent.vendor ? { vendor: agent.vendor } : {}),
    ...(normalized.provider
      ? { provider: normalized.provider }
      : {}),
    ...(agent.agent_name
      ? { agent_name: agent.agent_name }
      : {}),
    ...(agent.lease_model
      ? { lease_model: agent.lease_model }
      : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
    ...(normalized.version
      ? { version: normalized.version }
      : {}),
    ...((agent.label ?? formatAgentDisplayLabel(agent))
      ? {
        label:
          agent.label ??
          formatAgentDisplayLabel(agent),
      }
      : {}),
    ...(agentId ? { agentId } : {}),
  };
}
