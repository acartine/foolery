import type { RegisteredAgentConfig } from "@/lib/schemas";
import {
  detectAgentProviderId,
  normalizeAgentIdentity,
} from "@/lib/agent-identity";

interface NormalizeAgentConfigOptions {
  fillLabel: boolean;
}

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
  options: NormalizeAgentConfigOptions = {
    fillLabel: true,
  },
): RegisteredAgentConfig {
  const command = cleanString(agent.command) ?? agent.command;
  const label = cleanString(agent.label);
  const model = canonicalizeRuntimeModel(
    command,
    cleanString(agent.model),
  );
  const normalized = normalizeAgentIdentity({
    command,
    provider: cleanString(agent.provider),
    model,
    flavor: cleanString(agent.flavor),
    version: cleanString(agent.version),
    label,
  });

  return {
    command,
    ...(model ? { model } : {}),
    ...(normalized.provider
      ? { provider: normalized.provider }
      : {}),
    ...(normalized.flavor
      ? { flavor: normalized.flavor }
      : {}),
    ...(normalized.version
      ? { version: normalized.version }
      : {}),
    ...(label
      ? { label }
      : options.fillLabel && normalized.provider
        ? { label: normalized.provider }
        : {}),
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
      { fillLabel: false },
    );
    normalizedAgents[agentId] = normalizedAgent;

    for (const key of [
      "command",
      "model",
      "provider",
      "flavor",
      "version",
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
  return {
    normalized: normalizedRoot,
    changedPaths: Array.from(new Set(changedPaths)),
  };
}
