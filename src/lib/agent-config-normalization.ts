import type { RegisteredAgentConfig } from "@/lib/schemas";
import {
  detectAgentProviderId,
  formatAgentDisplayLabel,
  normalizeAgentIdentity,
  toCanonicalLeaseIdentity,
} from "@/lib/agent-identity";

interface SettingsNormalizationResult {
  normalized: Record<string, unknown>;
  changedPaths: string[];
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function canonicalizeClaudeModel(
  rawModel: string,
): string {
  const cleaned = rawModel.trim().toLowerCase();
  const match = cleaned.match(
    /^(claude-(?:opus|sonnet|haiku))-(\d+(?:[-.]\d+)*)(.*)$/u,
  );
  if (!match) return cleaned;

  const [, family, version, suffix] = match;
  return `${family}-${version.replace(/\./gu, "-")}${suffix}`;
}

export function canonicalizeRuntimeModel(
  command: string | undefined,
  rawModel: string | undefined,
): string | undefined {
  const cleaned = cleanString(rawModel);
  if (!cleaned) return undefined;

  const providerId = detectAgentProviderId(command);
  if (providerId === "claude") {
    return canonicalizeClaudeModel(cleaned);
  }

  return cleaned;
}

export function normalizeRegisteredAgentConfig(
  agent: RegisteredAgentConfig,
): RegisteredAgentConfig {
  const command = cleanString(agent.command) ?? agent.command;
  const model = canonicalizeRuntimeModel(
    command,
    cleanString(agent.model),
  );
  const canonical = toCanonicalLeaseIdentity({
    command,
    agent_type: cleanString(agent.agent_type),
    vendor: cleanString(agent.vendor),
    provider: cleanString(agent.provider),
    agent_name: cleanString(agent.agent_name),
    lease_model: cleanString(agent.lease_model),
    model,
    flavor: cleanString(agent.flavor),
    version: cleanString(agent.version),
  });

  return {
    command,
    ...(canonical.agent_type
      ? { agent_type: canonical.agent_type }
      : {}),
    ...(canonical.vendor
      ? { vendor: canonical.vendor }
      : {}),
    ...(canonical.provider
      ? { provider: canonical.provider }
      : {}),
    ...(canonical.agent_name
      ? { agent_name: canonical.agent_name }
      : {}),
    ...(canonical.lease_model
      ? { lease_model: canonical.lease_model }
      : {}),
    ...(model ? { model } : {}),
    ...(canonical.version
      ? { version: canonical.version }
      : {}),
  };
}

export function hydrateRegisteredAgentConfig(
  agent: RegisteredAgentConfig,
): RegisteredAgentConfig {
  const normalized = normalizeAgentIdentity(agent);
  const label = formatAgentDisplayLabel(agent);

  return {
    ...agent,
    ...(normalized.provider
      ? { provider: normalized.provider }
      : {}),
    ...(normalized.flavor
      ? { flavor: normalized.flavor }
      : {}),
    ...(normalized.version
      ? { version: normalized.version }
      : {}),
    ...(label ? { label } : {}),
  };
}

export function hydrateSettingsAgents(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(settings.agents)) {
    return settings;
  }

  return {
    ...settings,
    agents: Object.fromEntries(
      Object.entries(settings.agents).map(([agentId, rawAgent]) => {
        if (!isRecord(rawAgent) || typeof rawAgent.command !== "string") {
          return [agentId, rawAgent];
        }
        return [
          agentId,
          hydrateRegisteredAgentConfig(
            rawAgent as RegisteredAgentConfig,
          ),
        ];
      }),
    ),
  };
}

export function normalizeSettingsAgents(
  current: unknown,
): SettingsNormalizationResult {
  const normalizedRoot = structuredClone(
    isRecord(current) ? current : {},
  ) as Record<string, unknown>;
  const changedPaths: string[] = [];

  if (!isRecord(normalizedRoot.agents)) {
    return { normalized: normalizedRoot, changedPaths };
  }

  const normalizedAgents: Record<string, unknown> = {};
  for (const [agentId, rawAgent] of Object.entries(normalizedRoot.agents)) {
    if (!isRecord(rawAgent) || typeof rawAgent.command !== "string") {
      normalizedAgents[agentId] = rawAgent;
      continue;
    }

    const normalizedAgent = normalizeRegisteredAgentConfig(
      rawAgent as RegisteredAgentConfig,
    );
    normalizedAgents[agentId] = normalizedAgent;

    for (const key of [
      "command",
      "agent_type",
      "vendor",
      "provider",
      "agent_name",
      "lease_model",
      "model",
      "version",
      "flavor",
      "label",
    ] as const) {
      const before = cleanString(rawAgent[key]);
      const after = cleanString(normalizedAgent[key]);
      if (before !== after) {
        changedPaths.push(`agents.${agentId}.${key}`);
      }
    }
  }

  normalizedRoot.agents = normalizedAgents;

  const registeredIds = new Set(Object.keys(normalizedAgents));
  pruneOrphanActionRefs(normalizedRoot, registeredIds, changedPaths);
  pruneOrphanPoolRefs(normalizedRoot, registeredIds, changedPaths);

  return {
    normalized: normalizedRoot,
    changedPaths: Array.from(new Set(changedPaths)),
  };
}

const ACTION_KEYS = [
  "take",
  "scene",
  "breakdown",
  "scopeRefinement",
] as const;

function pruneOrphanActionRefs(
  root: Record<string, unknown>,
  registeredIds: Set<string>,
  changedPaths: string[],
): void {
  if (registeredIds.size === 0) return;
  if (!isRecord(root.actions)) return;
  const actions = root.actions;
  for (const key of ACTION_KEYS) {
    const value = actions[key];
    if (typeof value !== "string" || value === "") continue;
    if (!registeredIds.has(value)) {
      actions[key] = "";
      changedPaths.push(`actions.${key}`);
    }
  }
}

function pruneOrphanPoolRefs(
  root: Record<string, unknown>,
  registeredIds: Set<string>,
  changedPaths: string[],
): void {
  if (registeredIds.size === 0) return;
  if (!isRecord(root.pools)) return;
  const pools = root.pools;
  for (const [step, entries] of Object.entries(pools)) {
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((entry) => {
      if (!isRecord(entry)) return true;
      const agentId = entry.agentId;
      return typeof agentId !== "string" || registeredIds.has(agentId);
    });
    if (filtered.length !== entries.length) {
      pools[step] = filtered;
      changedPaths.push(`pools.${step}`);
    }
  }
}
