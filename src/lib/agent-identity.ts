/**
 * Per-provider canonical agent-identity extractors.
 *
 * **Single canonical form = display form.** The extractors below emit
 * display-cased strings (`"GPT"`, `"Claude"`, `"Opus"`, `"Pro"`,
 * `"OpenRouter MoonshotAI Kimi-k"`, etc.). The lease stamps display-
 * cased strings. Every reader renders the field as-is. There is no
 * machine-form vs display-form duality.
 *
 * See `docs/knots-agent-identity-contract.md` § "Single canonical form".
 */
import {
  parseOpenCodePath,
  formatOpenCodeSegment,
} from "@/lib/agent-identity-opencode-format";

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

// Canonical shapes are defined in `agent-identity-canonical.ts`; re-export
// them here so existing callers can keep importing from `@/lib/agent-identity`.
export type {
  CanonicalLeaseIdentity,
  CanonicalAgentConfig,
} from "@/lib/agent-identity-canonical";

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

/**
 * Display-form Codex flavour names. The single canonical form is what
 * the user sees in the UI; this table is the only place a Codex flavour
 * label is constructed.
 */
const CODEX_FLAVOR_DISPLAY: Record<string, string> = {
  "codex-max": "Codex Max",
  "codex-mini": "Codex Mini",
  "codex-spark": "Codex Spark",
  codex: "Codex",
  mini: "Mini",
};

function normalizeCodexModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return {};
  if (
    !cleaned.includes("gpt") &&
    !cleaned.includes("chatgpt") &&
    !cleaned.includes("codex")
  ) {
    return { model: rawModel?.trim() };
  }
  const versionMatch = cleaned.match(/(?:gpt|chatgpt)-?(\d+(?:\.\d+)*)/i);
  const model = cleaned.includes("chatgpt") ? "ChatGPT" : "GPT";
  const flavorKey = cleaned.includes("codex-max")
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
  const flavor = flavorKey
    ? CODEX_FLAVOR_DISPLAY[flavorKey]
    : undefined;
  return {
    model,
    ...(flavor ? { flavor } : {}),
    ...(versionMatch?.[1] ? { version: versionMatch[1] } : {}),
  };
}

/**
 * Display-form Claude flavour names. Title-cased family + optional
 * suffix in parentheses ("(1M context)", "(Fast)").
 */
function claudeFlavorDisplay(
  family: string,
  hasOneMillion: boolean,
  hasFast: boolean,
): string {
  const head = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  if (hasOneMillion) return `${head} (1M context)`;
  if (hasFast) return `${head} (Fast)`;
  return head;
}

function normalizeClaudeModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return {};
  const familyMatch = cleaned.match(/(opus|sonnet|haiku)/i);
  const versionMatch = cleaned.match(/(?:opus|sonnet|haiku)[- ](\d+(?:[-.]\d+)*)/i);
  const normalizedVersion = versionMatch?.[1]?.replace(/-/g, ".");
  const hasOneMillion = cleaned.includes("1m");
  const hasFast = /\bfast\b/.test(cleaned);
  const flavor = familyMatch?.[1]
    ? claudeFlavorDisplay(familyMatch[1], hasOneMillion, hasFast)
    : undefined;
  return {
    ...(familyMatch?.[1] ? { model: "Claude" } : {}),
    ...(flavor ? { flavor } : {}),
    ...(normalizedVersion ? { version: normalizedVersion } : {}),
  };
}

/**
 * Display-form Gemini flavour names.
 *   pro          -> "Pro"
 *   flash        -> "Flash"
 *   flash-lite   -> "Flash Lite"
 *   ...-preview  -> "<head> (Preview)"
 */
function geminiFlavorDisplay(
  family: string,
  preview: boolean,
): string {
  const head = family
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return preview ? `${head} (Preview)` : head;
}

function normalizeGeminiModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel)?.toLowerCase();
  if (!cleaned) return { model: "Gemini" };
  const versionMatch = cleaned.match(/gemini[- ](\d+(?:\.\d+)*)/i);
  const familyMatch = cleaned.match(/(pro|flash-lite|flash)(?:-(preview))?/i);
  const flavor = familyMatch?.[1]
    ? geminiFlavorDisplay(familyMatch[1], Boolean(familyMatch[2]))
    : undefined;
  return {
    model: "Gemini",
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
 * Returns display-form output (per the single-canonical-form contract):
 *   model:   pre-formatted display string, e.g.
 *            "OpenRouter MoonshotAI Kimi-k" for
 *            "openrouter/moonshotai/kimi-k2.6".
 *   flavor:  always undefined for OpenCode (the router segment is
 *            already part of the formatted `model` string; emitting it
 *            separately would double-stamp it).
 *   version: trailing numeric segment of the last token, e.g. "2.6".
 */
function normalizeOpenCodeModel(
  rawModel?: string,
): { model?: string; flavor?: string; version?: string } {
  const cleaned = cleanValue(rawModel);
  if (!cleaned) return {};
  const parts = parseOpenCodePath(cleaned);
  return {
    ...(parts.model ? { model: parts.model } : {}),
    ...(parts.version ? { version: parts.version } : {}),
  };
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

interface NormalizedAgentIdentity {
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
}

/**
 * Apply per-provider extractor result with parsed values preferred.
 *
 * The extractor's parsed `flavor` and `version` win over the caller's
 * input when both are present. This is what makes the foolery-b42b
 * migration work: legacy machine-form values (`flavor: "opus"`) on
 * disk get overwritten by the display-form values the extractor
 * produces (`flavor: "Opus"`). The caller's input is honoured only as
 * a last-resort fallback when the extractor produced nothing (e.g.
 * non-Claude/non-Codex models, or registered configs that explicitly
 * carry version metadata for an unsupported provider).
 */
function combineProviderResult(
  provider: string,
  parsed: { model?: string; flavor?: string; version?: string },
  fallback: { flavor?: string; version?: string },
): NormalizedAgentIdentity {
  return {
    provider,
    ...(parsed.model ? { model: parsed.model } : {}),
    ...(parsed.flavor ?? fallback.flavor
      ? { flavor: parsed.flavor ?? fallback.flavor }
      : {}),
    ...(parsed.version ?? fallback.version
      ? { version: parsed.version ?? fallback.version }
      : {}),
  };
}

export function normalizeAgentIdentity(
  agent: AgentIdentityLike,
): NormalizedAgentIdentity {
  const provider = providerLabel(agent.provider, agent.command);
  const version = cleanValue(agent.version);
  const flavor = cleanValue(agent.flavor);
  const rawModel = cleanValue(agent.model);
  if (provider === "OpenCode") {
    const normalized = normalizeOpenCodeModel(rawModel);
    // OpenCode emits no flavor — the router segment is part of the
    // formatted `model` string. Per the canonical contract,
    // agent.version on the input may carry the OpenCode binary
    // version (a runtime hint, not a model version) — letting it
    // override would re-introduce the leak this extractor exists to
    // prevent. The path-derived version is the only authoritative
    // source when the path produced one. Caller version is a
    // last-resort fallback for path-less / version-less model ids.
    const fallbackVersion = normalized.version ?? version;
    return {
      provider,
      ...(normalized.model ?? rawModel
        ? { model: normalized.model ?? rawModel }
        : {}),
      ...(fallbackVersion ? { version: fallbackVersion } : {}),
    };
  }
  if (provider === "Copilot") {
    const normalized = normalizeCopilotModel(rawModel);
    return combineProviderResult(
      normalized.provider,
      {
        ...(normalized.model ? { model: normalized.model } : {}),
        ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
        ...(normalized.version ? { version: normalized.version } : {}),
      },
      { flavor, version },
    );
  }
  if (provider === "Codex") {
    return combineProviderResult(
      provider,
      normalizeCodexModel(rawModel),
      { flavor, version },
    );
  }
  if (provider === "Claude") {
    return combineProviderResult(
      provider,
      normalizeClaudeModel(rawModel),
      { flavor, version },
    );
  }
  if (provider === "Gemini") {
    return combineProviderResult(
      provider,
      normalizeGeminiModel(rawModel),
      { flavor, version },
    );
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

/**
 * Single-rule display-label join.
 *
 * Per AC-5 of foolery-b42b: no per-provider branching, no MODEL_LABELS
 * lookup, no `formatModelDisplay` call. The extractors emit display-
 * form values; this function concatenates them with spaces and drops
 * any field that is redundant with the provider name (e.g. provider
 * "Claude" + model "Claude" -> just "Claude Sonnet 4.5", not
 * "Claude Claude Sonnet 4.5"; provider "Codex" + flavor "Codex" ->
 * just "Codex GPT 5.4", not "Codex GPT Codex 5.4"). The
 * "drop fields redundant with the provider" rule is uniform across
 * providers — not a per-provider branch.
 */
export function formatAgentFamily(option: AgentOptionSeed): string {
  const provider = cleanValue(option.provider);
  const model = cleanValue(option.model);
  const flavor = cleanValue(option.flavor);
  const sameAsProvider = (s: string | undefined): boolean =>
    Boolean(s && provider && s.toLowerCase() === provider.toLowerCase());
  const modelOut = sameAsProvider(model) ? undefined : model;
  const flavorOut = sameAsProvider(flavor) ? undefined : flavor;
  return [provider, modelOut, flavorOut].filter(Boolean).join(" ");
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

export function parseAgentDisplayParts(
  agent: AgentIdentityLike,
): AgentDisplayParts {
  const providerId = detectAgentProviderId(agent.command);
  const pills: string[] = [];

  if (providerId === "opencode") {
    return openCodeDisplayParts(agent);
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

function openCodeDisplayParts(
  agent: AgentIdentityLike,
): AgentDisplayParts {
  const rawModel = cleanValue(agent.model);
  const pills: string[] = [];
  if (!rawModel) {
    pills.push("cli");
    return { label: "OpenCode", pills };
  }
  if (rawModel.includes("/")) {
    return openCodePathDisplayParts(rawModel, agent.version);
  }
  // Bare model — single segment, no router pill.
  pills.push("opencode");
  pills.push("cli");
  const single = formatOpenCodeSegment(rawModel);
  const version = cleanValue(agent.version);
  return {
    label: ["OpenCode", single, version].filter(Boolean).join(" "),
    pills,
  };
}

function openCodePathDisplayParts(
  rawModel: string,
  version?: string,
): AgentDisplayParts {
  const parsed = parseOpenCodePath(rawModel);
  const v = parsed.version ?? cleanValue(version);
  const labelParts = ["OpenCode", parsed.model, v].filter(Boolean);
  const pills: string[] = [];
  if (parsed.router) pills.push(parsed.router);
  pills.push("cli");
  return { label: labelParts.join(" "), pills };
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

// Canonical extractors (see `agent-identity-canonical.ts` for the
// implementation). Re-exported here so existing callers continue to
// import from `@/lib/agent-identity` without churn.
export {
  toCanonicalLeaseIdentity,
  toCanonicalAgentConfig,
  toExecutionAgentInfo,
} from "@/lib/agent-identity-canonical";
