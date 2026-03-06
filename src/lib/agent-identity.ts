export type AgentProviderId =
  | "claude"
  | "openai"
  | "gemini"
  | "openrouter"
  | "unknown";

export interface AgentIdentityLike {
  command?: string;
  provider?: string;
  model?: string;
  version?: string;
  label?: string;
}

export interface AgentOptionSeed {
  provider?: string;
  model?: string;
  version?: string;
}

const PROVIDER_LABELS: Record<Exclude<AgentProviderId, "unknown">, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

const MODEL_LABELS: Record<string, string> = {
  codex: "Codex",
  "codex-spark": "Codex Spark",
  "codex-max": "Codex Max",
  "codex-mini": "Codex Mini",
  gpt: "GPT",
  chatgpt: "ChatGPT",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  gemini: "Gemini",
  pro: "Pro",
  flash: "Flash",
  "flash-lite": "Flash Lite",
};

function cleanValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function detectAgentProviderId(command?: string): AgentProviderId {
  const lower = command?.trim().toLowerCase() ?? "";
  if (!lower) return "unknown";
  if (lower.includes("openrouter")) return "openrouter";
  if (lower.includes("claude")) return "claude";
  if (
    lower.includes("codex") ||
    lower.includes("chatgpt") ||
    lower.includes("openai")
  ) {
    return "openai";
  }
  if (lower.includes("gemini")) return "gemini";
  return "unknown";
}

export function providerLabel(provider?: string, command?: string): string | undefined {
  const cleaned = cleanValue(provider);
  if (cleaned) return cleaned;
  const detected = detectAgentProviderId(command);
  if (detected === "unknown") return undefined;
  return PROVIDER_LABELS[detected];
}

function normalizeCodexModel(rawModel?: string): { model?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return { model: "codex" };
  if (
    !cleaned.includes("gpt") &&
    !cleaned.includes("chatgpt") &&
    !cleaned.includes("codex")
  ) {
    return { model: rawModel?.trim() };
  }
  const versionMatch = cleaned.match(/(?:gpt|chatgpt)-?(\d+(?:\.\d+)*)/i);
  return {
    model: cleaned.includes("chatgpt") ? "chatgpt" : "codex",
    ...(versionMatch?.[1] ? { version: versionMatch[1] } : {}),
  };
}

function normalizeClaudeModel(rawModel?: string): { model?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return {};

  const familyMatch = cleaned.match(/(opus|sonnet|haiku)/i);
  const versionMatch = cleaned.match(/(?:opus|sonnet|haiku)[- ](\d+(?:[-.]\d+)*)/i);
  const normalizedVersion = versionMatch?.[1]?.replace(/-/g, ".");

  return {
    ...(familyMatch?.[1] ? { model: familyMatch[1].toLowerCase() } : {}),
    ...(normalizedVersion ? { version: normalizedVersion } : {}),
  };
}

function normalizeGeminiModel(rawModel?: string): { model?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return { model: "gemini" };
  const versionMatch = cleaned.match(/gemini[- ](\d+(?:\.\d+)*)/i);
  const familyMatch = cleaned.match(/(pro|flash-lite|flash)/i);
  return {
    model: familyMatch?.[1]?.toLowerCase() ?? "gemini",
    ...(versionMatch?.[1] ? { version: versionMatch[1] } : {}),
  };
}

export function normalizeAgentIdentity(agent: AgentIdentityLike): {
  provider?: string;
  model?: string;
  version?: string;
} {
  const provider = providerLabel(agent.provider, agent.command);
  const version = cleanValue(agent.version);
  if (provider === "OpenAI") {
    const normalized = normalizeCodexModel(agent.model);
    return {
      provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(version ?? normalized.version ? { version: version ?? normalized.version } : {}),
    };
  }
  if (provider === "Claude") {
    const normalized = normalizeClaudeModel(agent.model);
    return {
      provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(version ?? normalized.version ? { version: version ?? normalized.version } : {}),
    };
  }
  if (provider === "Gemini") {
    const normalized = normalizeGeminiModel(agent.model);
    return {
      provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(version ?? normalized.version ? { version: version ?? normalized.version } : {}),
    };
  }
  return {
    ...(provider ? { provider } : {}),
    ...(cleanValue(agent.model) ? { model: cleanValue(agent.model) } : {}),
    ...(version ? { version } : {}),
  };
}

export function agentDisplayName(agent: AgentIdentityLike): string {
  return (
    providerLabel(agent.provider, agent.command) ??
    cleanValue(agent.label) ??
    cleanValue(agent.command) ??
    "Unknown"
  );
}

export function formatModelDisplay(model?: string): string | undefined {
  const cleaned = cleanValue(model);
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  return MODEL_LABELS[lower] ?? cleaned;
}

export function formatAgentOptionLabel(option: AgentOptionSeed): string {
  const provider = providerLabel(option.provider);
  const model = formatModelDisplay(option.model);
  const version = cleanValue(option.version);
  return [provider, model, version].filter(Boolean).join(" ");
}

export function buildAgentOptionId(
  agentId: string,
  option: AgentOptionSeed,
): string {
  const parts = [
    agentId,
    cleanValue(option.model)?.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    cleanValue(option.version)?.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ].filter(Boolean);
  return parts.join("-");
}

function dedupeAgentOptions(
  agentId: string,
  options: AgentOptionSeed[],
): AgentOptionSeed[] {
  const seen = new Set<string>();
  const deduped: AgentOptionSeed[] = [];
  for (const option of options) {
    const id = buildAgentOptionId(agentId, option);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(option);
  }
  return deduped;
}

export function buildAgentImportOptions(
  agentId: string,
  detected: AgentOptionSeed,
): Array<AgentOptionSeed & { id: string; label: string }> {
  const provider = providerLabel(detected.provider, agentId);
  const baseVersion = cleanValue(detected.version);
  const hasDetectedModel = Boolean(cleanValue(detected.model) || cleanValue(detected.version));
  const detectedSeed = hasDetectedModel ? [{ ...detected, provider }] : [];

  const seeds: AgentOptionSeed[] =
    provider === "Claude"
      ? [
          ...detectedSeed,
          { provider, model: "opus", version: "4.5" },
          { provider, model: "sonnet", version: "4.5" },
          { provider, model: "haiku", version: "4.5" },
        ]
      : provider === "OpenAI"
        ? [
            ...detectedSeed,
            { provider, model: "gpt", version: baseVersion },
            { provider, model: "codex", version: baseVersion },
            { provider, model: "codex-spark", version: baseVersion },
            { provider, model: "codex-max", version: baseVersion },
            { provider, model: "codex-mini", version: baseVersion },
          ]
        : provider === "Gemini"
          ? [
              ...detectedSeed,
              { provider, model: "pro", version: baseVersion },
              { provider, model: "flash", version: baseVersion },
              { provider, model: "flash-lite", version: baseVersion },
            ]
          : [detected];

  return dedupeAgentOptions(agentId, seeds).map((option) => ({
    ...option,
    id: buildAgentOptionId(agentId, option),
    label: formatAgentOptionLabel(option),
  }));
}
