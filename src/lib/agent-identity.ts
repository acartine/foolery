export type AgentProviderId =
  | "claude"
  | "openai"
  | "gemini"
  | "opencode"
  | "unknown";

export interface AgentIdentityLike {
  command?: string;
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
  label?: string;
  kind?: "cli";
}

export interface AgentOptionSeed {
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
  modelId?: string;
}

const PROVIDER_LABELS: Record<Exclude<AgentProviderId, "unknown">, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  opencode: "OpenCode",
};

const MODEL_LABELS: Record<string, string> = {
  claude: "Claude",
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
  "opus-1m": "Opus (1M context)",
  "sonnet-1m": "Sonnet (1M context)",
  preview: "Preview",
  devstral: "Devstral",
};

function cleanValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function detectAgentProviderId(command?: string): AgentProviderId {
  const lower = command?.trim().toLowerCase() ?? "";
  if (!lower) return "unknown";
  if (lower.includes("opencode")) return "opencode";
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

function normalizeCodexModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return {};
  if (!cleaned.includes("gpt") && !cleaned.includes("chatgpt") && !cleaned.includes("codex")) {
    return { model: rawModel?.trim() };
  }

  const versionMatch = cleaned.match(/(?:gpt|chatgpt)-?(\d+(?:\.\d+)*)/i);
  const model = cleaned.includes("chatgpt") ? "chatgpt" : "gpt";
  const flavor = cleaned.includes("codex-max")
    ? "codex-max"
    : cleaned.includes("codex-mini")
      ? "codex-mini"
      : cleaned.includes("codex-spark")
        ? "codex-spark"
        : cleaned.includes("codex")
          ? "codex"
          : undefined;

  return {
    model,
    ...(flavor ? { flavor } : {}),
    ...(versionMatch?.[1] ? { version: versionMatch[1] } : {}),
  };
}

function normalizeClaudeModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return {};

  const familyMatch = cleaned.match(/(opus|sonnet|haiku)/i);
  const versionMatch = cleaned.match(/(?:opus|sonnet|haiku)[- ](\d+(?:[-.]\d+)*)/i);
  const normalizedVersion = versionMatch?.[1]?.replace(/-/g, ".");
  const hasOneMillionContext = cleaned.includes("1m");
  const flavor = familyMatch?.[1]
    ? `${familyMatch[1].toLowerCase()}${hasOneMillionContext ? "-1m" : ""}`
    : undefined;

  return {
    ...(familyMatch?.[1] ? { model: "claude" } : {}),
    ...(flavor ? { flavor } : {}),
    ...(normalizedVersion ? { version: normalizedVersion } : {}),
  };
}

function normalizeGeminiModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return { model: "gemini" };
  const versionMatch = cleaned.match(/gemini[- ](\d+(?:\.\d+)*)/i);
  const familyMatch = cleaned.match(/(pro|flash-lite|flash)(?:-(preview))?/i);
  const flavor = familyMatch?.[1]
    ? `${familyMatch[1].toLowerCase()}${familyMatch[2] ? `-${familyMatch[2].toLowerCase()}` : ""}`
    : undefined;
  return {
    model: "gemini",
    ...(flavor ? { flavor } : {}),
    ...(versionMatch?.[1] ? { version: versionMatch[1] } : {}),
  };
}

export function normalizeAgentIdentity(agent: AgentIdentityLike): {
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
} {
  const provider = providerLabel(agent.provider, agent.command);
  const version = cleanValue(agent.version);
  const flavor = cleanValue(agent.flavor);
  const rawModel = cleanValue(agent.model);
  if (provider === "OpenCode") {
    return {
      provider,
      ...(rawModel ? { model: rawModel } : {}),
      ...(flavor ? { flavor } : {}),
      ...(version ? { version } : {}),
    };
  }
  if (provider === "OpenAI") {
    const normalized = normalizeCodexModel(rawModel);
    return {
      provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(flavor ?? normalized.flavor ? { flavor: flavor ?? normalized.flavor } : {}),
      ...(version ?? normalized.version ? { version: version ?? normalized.version } : {}),
    };
  }
  if (provider === "Claude") {
    const normalized = normalizeClaudeModel(rawModel);
    return {
      provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(flavor ?? normalized.flavor ? { flavor: flavor ?? normalized.flavor } : {}),
      ...(version ?? normalized.version ? { version: version ?? normalized.version } : {}),
    };
  }
  if (provider === "Gemini") {
    const normalized = normalizeGeminiModel(rawModel);
    return {
      provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(flavor ?? normalized.flavor ? { flavor: flavor ?? normalized.flavor } : {}),
      ...(version ?? normalized.version ? { version: version ?? normalized.version } : {}),
    };
  }
  return {
    ...(provider ? { provider } : {}),
    ...(rawModel ? { model: rawModel } : {}),
    ...(flavor ? { flavor } : {}),
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

export function formatFlavorDisplay(flavor?: string): string | undefined {
  return formatModelDisplay(flavor);
}

export function formatAgentFamily(option: AgentOptionSeed): string {
  const provider = providerLabel(option.provider, option.model);
  const model = formatModelDisplay(option.model);
  const flavor = formatFlavorDisplay(option.flavor);

  if (provider === "OpenAI" && model === "GPT") {
    return [model, flavor].filter(Boolean).join(" ");
  }
  if (provider === "Claude") {
    return [provider, flavor].filter(Boolean).join(" ");
  }
  if (provider === "Gemini") {
    return [provider, flavor].filter(Boolean).join(" ");
  }
  return [provider, model, flavor].filter(Boolean).join(" ");
}

export function formatAgentOptionLabel(option: AgentOptionSeed): string {
  const version = cleanValue(option.version);
  return [formatAgentFamily(option), version].filter(Boolean).join(" ");
}

export function formatAgentDisplayLabel(
  agent: AgentIdentityLike,
): string {
  const normalized = normalizeAgentIdentity(agent);
  return formatAgentOptionLabel({
    provider: normalized.provider ?? agent.provider,
    model: normalized.model ?? agent.model,
    flavor: normalized.flavor ?? agent.flavor,
    version: normalized.version ?? agent.version,
  }) || cleanValue(agent.label) || cleanValue(agent.command) || "Unknown";
}

export function buildAgentOptionId(
  agentId: string,
  option: AgentOptionSeed,
): string {
  const modelId = cleanValue(option.modelId)?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (modelId) return [agentId, modelId].join("-");

  const parts = [
    agentId,
    cleanValue(option.model)?.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    cleanValue(option.flavor)?.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    cleanValue(option.version)?.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ].filter(Boolean);
  return parts.join("-");
}
