import type { ExecutionAgentInfo } from "@/lib/execution-port";

export type AgentProviderId =
  | "claude"
  | "copilot"
  | "codex"
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
  agent_type?: string;
  vendor?: string;
  agent_name?: string;
  lease_model?: string;
  kind?: "cli";
}

export interface CanonicalLeaseIdentity {
  agent_type?: string;
  vendor?: string;
  provider?: string;
  agent_name?: string;
  lease_model?: string;
  version?: string;
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
  copilot: "Copilot",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

const MODEL_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  "codex-spark": "Codex Spark",
  "codex-max": "Codex Max",
  "codex-mini": "Codex Mini",
  mini: "Mini",
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
  "opus-fast": "Opus (Fast)",
  "sonnet-fast": "Sonnet (Fast)",
  "haiku-fast": "Haiku (Fast)",
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
  if (lower.includes("copilot")) return "copilot";
  if (lower.includes("claude")) return "claude";
  if (
    lower.includes("codex") ||
    lower.includes("chatgpt") ||
    lower.includes("openai")
  ) {
    return "codex";
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
          : /\bmini\b/.test(cleaned)
            ? "mini"
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
  const hasFast = /\bfast\b/.test(cleaned);
  const suffix = hasOneMillionContext ? "-1m" : hasFast ? "-fast" : "";
  const flavor = familyMatch?.[1]
    ? `${familyMatch[1].toLowerCase()}${suffix}`
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

/**
 * Canonical OpenCode model extractor.
 *
 * Input is the raw model id string only — never the OpenCode binary
 * version, an env var, or any runtime hint. The OpenCode model id is a
 * slash-separated path of the form:
 *
 *   `<router>/<vendor>/<model-with-version>` (canonical 3-segment shape)
 *   `<vendor>/<model-with-version>`           (no router)
 *   `<bare-model>`                            (single token)
 *
 * Returns:
 *   model:   the full input (preserved verbatim — OpenCode addresses
 *            models by their full path).
 *   flavor:  the router (first token) when 3+ segments are present;
 *            otherwise undefined.
 *   version: the trailing numeric tail of the last token's last
 *            hyphen-separated segment, matched by `/(\d+(?:\.\d+)*)$/`.
 *            Examples:
 *              `kimi-k2.6`           -> "2.6"  (k prefix is not numeric)
 *              `claude-sonnet-4-5`   -> "4.5"  (consecutive trailing
 *                                              numeric segments joined)
 *              `glm-5.1`             -> "5.1"
 *              `devstral-2512`       -> "2512"
 *              `kimi`                -> undefined (no numeric tail)
 */
function normalizeOpenCodeModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel);
  if (!cleaned) return {};
  const tokens = cleaned.split("/").filter(Boolean);
  if (tokens.length === 0) return {};
  const flavor = tokens.length >= 3 ? tokens[0] : undefined;
  const version = extractOpenCodeTrailingVersion(tokens[tokens.length - 1]!);
  return {
    model: cleaned,
    ...(flavor ? { flavor } : {}),
    ...(version ? { version } : {}),
  };
}

/**
 * Extracts the trailing numeric version from the last segment of an
 * OpenCode model token. Joins consecutive trailing hyphen-separated
 * numeric segments with dots so `claude-sonnet-4-5` -> `"4.5"`.
 */
function extractOpenCodeTrailingVersion(token: string): string | undefined {
  const tail = token.match(/(\d+(?:\.\d+)*)$/)?.[1];
  if (!tail) return undefined;
  // Walk backward through hyphen-separated segments to capture
  // `claude-sonnet-4-5` -> ["4","5"] -> "4.5".
  const segments = token.split("-");
  const trailingNumeric: string[] = [];
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (/^\d+(?:\.\d+)*$/.test(segments[i]!)) {
      trailingNumeric.unshift(segments[i]!);
    } else {
      break;
    }
  }
  return trailingNumeric.length > 0 ? trailingNumeric.join(".") : tail;
}

function normalizeCopilotModel(
  rawModel?: string,
): {
  provider: string;
  model?: string;
  flavor?: string;
  version?: string;
} {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) {
    return { provider: "Copilot" };
  }

  if (
    cleaned.includes("gpt") ||
    cleaned.includes("chatgpt") ||
    cleaned.includes("codex")
  ) {
    const normalized = normalizeCodexModel(rawModel);
    return {
      provider: "Codex",
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
    };
  }

  if (cleaned.includes("gemini")) {
    const normalized = normalizeGeminiModel(rawModel);
    return {
      provider: "Gemini",
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
    };
  }

  if (
    cleaned.includes("claude") ||
    cleaned.includes("opus") ||
    cleaned.includes("sonnet") ||
    cleaned.includes("haiku")
  ) {
    const normalized = normalizeClaudeModel(rawModel);
    return {
      provider: "Claude",
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
    };
  }

  return {
    provider: "Copilot",
    ...(rawModel?.trim() ? { model: rawModel.trim() } : {}),
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
    const normalized = normalizeOpenCodeModel(rawModel);
    // For OpenCode, the parsed path version wins over agent.version.
    // Per the canonical contract, agent.version on the input may carry
    // the OpenCode binary version (a runtime hint, not a model
    // version) — letting it override would re-introduce the leak this
    // extractor exists to prevent. The path-derived version is the
    // only authoritative source.
    return {
      provider,
      ...(normalized.model ?? rawModel
        ? { model: normalized.model ?? rawModel }
        : {}),
      ...(flavor ?? normalized.flavor
        ? { flavor: flavor ?? normalized.flavor }
        : {}),
      ...(normalized.version ?? version
        ? { version: normalized.version ?? version }
        : {}),
    };
  }
  if (provider === "Copilot") {
    const normalized = normalizeCopilotModel(rawModel);
    return {
      provider: normalized.provider,
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(flavor ?? normalized.flavor
        ? { flavor: flavor ?? normalized.flavor }
        : {}),
      ...(version ?? normalized.version
        ? { version: version ?? normalized.version }
        : {}),
    };
  }
  if (provider === "Codex") {
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

const COMMAND_DISPLAY_LABELS: Record<string, string> = {
  claude: "Claude",
  copilot: "Copilot",
  codex: "Codex",
  "codex-cli": "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export function displayCommandLabel(command?: string): string | undefined {
  const lower = cleanValue(command)?.toLowerCase();
  if (!lower) return undefined;
  if (COMMAND_DISPLAY_LABELS[lower]) return COMMAND_DISPLAY_LABELS[lower];
  for (const [key, label] of Object.entries(COMMAND_DISPLAY_LABELS)) {
    if (lower.includes(key)) return label;
  }
  return undefined;
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

  if (provider === "Codex" && model === "GPT") {
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

/* ── Structured display parts (label + pills) ────────────── */

export interface AgentDisplayParts {
  label: string;
  pills: string[];
}

function capitalizeToken(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatModelToken(token: string): string {
  return token
    .split("-")
    .map((p) => (MODEL_LABELS[p.toLowerCase()] ?? capitalizeToken(p)))
    .join(" ");
}

function parseOpenCodeModelPath(rawModel: string): {
  label: string;
  routerPill?: string;
} {
  const tokens = rawModel.split("/").filter(Boolean);
  if (tokens.length >= 3) {
    const router = tokens[0]!;
    const vendor = capitalizeToken(tokens[tokens.length - 2]!);
    const modelVersion = formatModelToken(tokens[tokens.length - 1]!);
    return { label: `${vendor} ${modelVersion}`, routerPill: router };
  }
  if (tokens.length === 2) {
    const vendor = capitalizeToken(tokens[0]!);
    const model = formatModelToken(tokens[1]!);
    return { label: `${vendor} ${model}`, routerPill: undefined };
  }
  if (tokens.length === 1) {
    return { label: formatModelToken(tokens[0]!), routerPill: undefined };
  }
  return { label: rawModel, routerPill: undefined };
}

export function parseAgentDisplayParts(
  agent: AgentIdentityLike,
): AgentDisplayParts {
  const providerId = detectAgentProviderId(agent.command);
  const pills: string[] = [];

  if (providerId === "opencode") {
    const rawModel = cleanValue(agent.model);
    if (rawModel && rawModel.includes("/")) {
      const parsed = parseOpenCodeModelPath(rawModel);
      if (parsed.routerPill) pills.push(parsed.routerPill);
      pills.push("cli");
      return { label: parsed.label, pills };
    }
    // Non-path model: use existing display, add opencode + cli pills
    if (rawModel) {
      pills.push("opencode");
      pills.push("cli");
      return { label: formatModelToken(rawModel), pills };
    }
    pills.push("cli");
    return { label: "OpenCode", pills };
  }

  if (providerId === "copilot") {
    pills.push("copilot");
    pills.push("cli");
    return {
      label: formatAgentDisplayLabel(agent),
      pills,
    };
  }

  // Claude, Codex, Gemini — use existing label, add cli pill
  pills.push("cli");
  return { label: formatAgentDisplayLabel(agent), pills };
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

export function toCanonicalLeaseIdentity(
  agent: AgentIdentityLike,
): CanonicalLeaseIdentity {
  const n = normalizeAgentIdentity(agent);
  const explicitCommand = cleanValue(agent.command);
  const agentType =
    cleanValue(agent.agent_type)
    ?? cleanValue(agent.kind)
    ?? "cli";
  const vendor = cleanValue(agent.vendor)
    ?? (explicitCommand
      ? detectAgentProviderId(explicitCommand)
      : undefined);
  const provider = cleanValue(agent.provider) ?? n.provider;
  const agentName = cleanValue(agent.agent_name)
    ?? displayCommandLabel(explicitCommand)
    ?? provider
    ?? explicitCommand
    ?? "Unknown";
  // OpenCode model strings are already canonical paths
  // (e.g. "openrouter/moonshotai/kimi-k2.6"); the flavor (router) is
  // encoded inside the path. Prepending flavor here would double-stamp
  // it (e.g. "openrouter/openrouter/moonshotai/kimi-k2.6"). Other
  // providers' model strings are short tokens ("claude", "gpt") where
  // flavor disambiguates, so the flavor/model join is correct.
  const derivedLeaseModel = n.provider === "OpenCode"
    ? (n.model ?? cleanValue(agent.model))
    : [n.flavor, n.model].filter(Boolean).join("/")
      || cleanValue(agent.model);
  const leaseModel = cleanValue(agent.lease_model)
    ?? derivedLeaseModel;

  return {
    ...(agentType ? { agent_type: agentType } : {}),
    ...(vendor && vendor !== "unknown" ? { vendor } : {}),
    ...(provider ? { provider } : {}),
    ...(agentName ? { agent_name: agentName } : {}),
    ...(leaseModel ? { lease_model: leaseModel } : {}),
    ...(n.version ? { version: n.version } : {}),
  };
}

export function toExecutionAgentInfo(agent: AgentIdentityLike): ExecutionAgentInfo {
  const canonical = toCanonicalLeaseIdentity(agent);
  return {
    agentName: canonical.agent_name,
    agentProvider: canonical.provider,
    agentModel: canonical.lease_model,
    agentVersion: canonical.version,
    agentType: canonical.agent_type,
  };
}
