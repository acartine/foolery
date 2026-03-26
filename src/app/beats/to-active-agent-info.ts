import type { AgentInfo } from "@/components/beat-columns";
import {
  displayCommandLabel,
  formatAgentFamily,
  normalizeAgentIdentity,
} from "@/lib/agent-identity";

export function toActiveAgentInfo(input: {
  agentCommand?: string;
  agentName?: string;
  model?: string;
  version?: string;
}): AgentInfo {
  const command = input.agentCommand ?? input.agentName;
  const normalized = normalizeAgentIdentity({
    command,
    model: input.model,
    version: input.version,
  });
  const agentName =
    displayCommandLabel(command) ?? input.agentName;
  const family = formatAgentFamily({
    provider: normalized.provider,
    model: normalized.model,
    flavor: normalized.flavor,
  });
  const prefix = `${agentName} `;
  const modelDisplay =
    family && agentName && family.startsWith(prefix)
      ? family.slice(agentName.length + 1)
      : family;
  return {
    agentName,
    model: modelDisplay || input.model,
    version: normalized.version,
  };
}
