/**
 * OpenCode router-path segment formatter.
 *
 * Used by `normalizeOpenCodeModel` (in `agent-identity.ts`) to turn a raw
 * model string like `openrouter/moonshotai/kimi-k2.6` into a clean
 * display-form string `OpenRouter MoonshotAI Kimi-k` with the trailing
 * version (`2.6`) split off.
 *
 * Three path shapes are supported:
 *   `<router>/<vendor>/<model-with-version>`  (canonical 3-segment)
 *   `<vendor>/<model-with-version>`           (no router)
 *   `<bare-model>`                            (single token)
 *
 * The output is the single-canonical-form contract per
 * `docs/knots-agent-identity-contract.md` § "Single canonical form".
 * Callers stamp this string verbatim onto the lease's `model` field;
 * downstream renderers do NOT post-process it.
 */

/**
 * Known compound vendor names with their canonical capitalisation.
 *
 * The vocabulary is intentionally small and case-insensitive on lookup.
 * Adding a new vendor is a one-line entry. Default behaviour for tokens
 * not in this map is per `capitalizeWithSuffix`.
 */
const VENDOR_DISPLAY_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  moonshotai: "MoonshotAI",
  anthropic: "Anthropic",
  "z-ai": "Z-AI",
  mistral: "Mistral",
  mistralai: "MistralAI",
  google: "Google",
  copilot: "Copilot",
  opencode: "OpenCode",
  openai: "OpenAI",
  meta: "Meta",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  xai: "xAI",
  perplexity: "Perplexity",
  cohere: "Cohere",
  // Acronym-form model families (rendered as the published canonical
  // capitalisation rather than auto title-case).
  glm: "GLM",
  llama: "Llama",
  bert: "BERT",
  rwkv: "RWKV",
  t5: "T5",
};

/**
 * Common AI/ML/IO/JS suffixes — when a token ends in one of these, the
 * suffix is uppercased while the rest of the token is title-cased. So a
 * future `someothervendorai` becomes `SomeOtherVendorAI` without a
 * vocabulary update.
 */
const TRAILING_UPPER_SUFFIXES = ["ai", "ml", "io", "js"] as const;

function capitalizeWithSuffix(token: string): string {
  if (!token) return token;
  const lower = token.toLowerCase();
  for (const suffix of TRAILING_UPPER_SUFFIXES) {
    if (
      lower.length > suffix.length &&
      lower.endsWith(suffix)
    ) {
      const stem = lower.slice(0, -suffix.length);
      return capitalizeFirst(stem) + suffix.toUpperCase();
    }
  }
  return capitalizeFirst(lower);
}

function capitalizeFirst(token: string): string {
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Format a single path segment (router or vendor) using the vocabulary
 * table first, then the suffix-uppercase rule, then plain capitalisation.
 */
export function formatOpenCodeSegment(token: string): string {
  if (!token) return token;
  const lookup = VENDOR_DISPLAY_NAMES[token.toLowerCase()];
  if (lookup) return lookup;
  return capitalizeWithSuffix(token);
}

/**
 * Split a model token into its display-cased model-name part and a
 * trailing version. The version is the longest run of trailing
 * hyphen-separated numeric segments joined by dots:
 *   `claude-sonnet-4-5` -> { name: "Claude Sonnet", version: "4.5" }
 *   `kimi-k2.6`         -> { name: "Kimi-k",        version: "2.6" }
 *   `glm-5.1`           -> { name: "Glm",           version: "5.1" }
 *   `devstral-2512`     -> { name: "Devstral",      version: "2512" }
 *   `gemini-2.5-pro`    -> { name: "Gemini",        version: "2.5",
 *                            tail: "Pro" }   (tail is non-numeric residue
 *                            after the version run)
 *   `kimi`              -> { name: "Kimi",          version: undefined }
 */
export interface OpenCodeModelSplit {
  name: string;
  version?: string;
  tail?: string;
}

export function splitOpenCodeModelToken(token: string): OpenCodeModelSplit {
  if (!token) return { name: "" };
  const segments = token.split("-");
  // Find the first segment that contains a trailing numeric tail.
  // A segment is "version-bearing" if it is fully numeric
  // ("4", "5", "2.6") OR has a non-numeric prefix followed by a
  // trailing numeric tail ("k2.6", "k1.5"). The trailing tail is
  // matched by /(\d+(?:\.\d+)*)$/.
  const firstVersionIdx = segments.findIndex((s) =>
    /(\d+(?:\.\d+)*)$/.test(s),
  );
  if (firstVersionIdx < 0) {
    return { name: formatModelName(token) };
  }
  const versionTokens = collectVersionTokens(segments, firstVersionIdx);
  if (versionTokens.values.length === 0) {
    return { name: formatModelName(token) };
  }
  const nameParts = segments.slice(0, firstVersionIdx);
  // The first version-bearing segment may have a non-numeric prefix
  // (e.g. "k2.6" -> prefix "k"). Restore it onto the name.
  if (versionTokens.firstSegmentPrefix) {
    nameParts.push(versionTokens.firstSegmentPrefix);
  }
  const tailSegments = segments.slice(versionTokens.afterIdx);
  const split: OpenCodeModelSplit = {
    name: formatModelName(nameParts.join("-")),
    version: versionTokens.values.join("."),
  };
  if (tailSegments.length > 0) {
    split.tail = tailSegments
      .map((s) => formatOpenCodeSegment(s))
      .join(" ");
  }
  return split;
}

interface VersionTokens {
  values: string[];
  /** Non-numeric prefix from the first version-bearing segment. */
  firstSegmentPrefix?: string;
  /** Index of the first non-version segment after the version run. */
  afterIdx: number;
}

function collectVersionTokens(
  segments: string[],
  startIdx: number,
): VersionTokens {
  const values: string[] = [];
  const first = segments[startIdx]!;
  const m = first.match(/^(.*?)(\d+(?:\.\d+)*)$/);
  if (!m) return { values, afterIdx: startIdx };
  const prefix = m[1] ?? "";
  values.push(m[2]!);
  let i = startIdx + 1;
  while (
    i < segments.length &&
    /^\d+(?:\.\d+)*$/.test(segments[i]!)
  ) {
    values.push(segments[i]!);
    i += 1;
  }
  return {
    values,
    ...(prefix ? { firstSegmentPrefix: prefix } : {}),
    afterIdx: i,
  };
}

/**
 * Format the model-name part of a token (everything before the trailing
 * version run). The leading hyphen-separated word gets the
 * `formatOpenCodeSegment` treatment (so `kimi` -> `Kimi`); subsequent
 * words are simply capitalised. This avoids double-applying the
 * vocabulary table to a model like `kimi-k` where `k` is part of the
 * model name (would otherwise become `Kimi K`, but we want `Kimi-k`).
 *
 * Heuristic: if the trailing word is a single letter (often a model
 * variant tag like `k` in `kimi-k`), keep the hyphen and lowercase the
 * letter. Otherwise insert a space and title-case.
 */
function formatModelName(name: string): string {
  if (!name) return name;
  const parts = name.split("-");
  const head = formatOpenCodeSegment(parts[0]!);
  if (parts.length === 1) return head;
  let result = head;
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (part.length === 1) {
      result += `-${part.toLowerCase()}`;
    } else {
      result += ` ${formatOpenCodeSegment(part)}`;
    }
  }
  return result;
}

export interface OpenCodePathParts {
  /** Display-form composite string, e.g. "OpenRouter MoonshotAI Kimi-k". */
  model: string;
  /** Trailing numeric version split off the model token, when present. */
  version?: string;
  /** Router segment (raw, lower-case) when 3+ segments are present. */
  router?: string;
  /** Vendor segment (raw, lower-case) when 2+ segments are present. */
  vendor?: string;
}

/**
 * Parse an OpenCode router path into display-form parts.
 *
 * `model` is the pre-formatted display string (router + vendor +
 * model-name with the trailing version split off). `version` is the
 * trailing numeric tail. `router` and `vendor` carry the raw lower-case
 * segments for routing-aware callers (currently only the rendering layer
 * uses them, as the `model` string already includes their display form).
 */
export function parseOpenCodePath(rawModel: string): OpenCodePathParts {
  if (!rawModel) return { model: "" };
  const tokens = rawModel.split("/").filter(Boolean);
  if (tokens.length === 0) return { model: rawModel };

  const lastToken = tokens[tokens.length - 1]!;
  const split = splitOpenCodeModelToken(lastToken);

  if (tokens.length >= 3) {
    return composeParts({
      router: tokens[0]!,
      vendor: tokens[tokens.length - 2]!,
      split,
    });
  }
  if (tokens.length === 2) {
    return composeParts({
      vendor: tokens[0]!,
      split,
    });
  }
  return composeParts({ split });
}

function composeParts(input: {
  router?: string;
  vendor?: string;
  split: OpenCodeModelSplit;
}): OpenCodePathParts {
  const { router, vendor, split } = input;
  const segments: string[] = [];
  if (router) segments.push(formatOpenCodeSegment(router));
  if (vendor) segments.push(formatOpenCodeSegment(vendor));
  if (split.name) segments.push(split.name);
  if (split.tail) segments.push(split.tail);
  return {
    model: segments.join(" "),
    ...(split.version ? { version: split.version } : {}),
    ...(router ? { router } : {}),
    ...(vendor ? { vendor } : {}),
  };
}
