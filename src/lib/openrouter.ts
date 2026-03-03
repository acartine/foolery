/**
 * OpenRouter API client -- fetches available models and their pricing.
 *
 * API docs: https://openrouter.ai/docs/api-reference/list-available-models
 * Base URL: https://openrouter.ai/api/v1
 * Models endpoint: GET /api/v1/models (no auth required for listing)
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_SELECTED_AGENT_ID = "openrouter:selected";

interface OpenRouterSelectionLike {
  enabled?: boolean;
  model?: string;
}

/**
 * Returns the currently selected OpenRouter model when the integration is
 * enabled; otherwise returns null.
 */
export function getSelectedOpenRouterModel(
  openrouter: OpenRouterSelectionLike | null | undefined,
): string | null {
  if (!openrouter?.enabled) return null;
  const model = openrouter.model?.trim();
  return model ? model : null;
}

/** Human-readable label for the virtual "selected OpenRouter model" agent. */
export function formatOpenRouterSelectedAgentLabel(modelId: string): string {
  return `OpenRouter (${modelId})`;
}

export interface OpenRouterModelPricing {
  prompt: string; // cost per token (string number)
  completion: string;
  image: string;
  request: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterModelPricing;
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

function normalizeModelRef(value: string): string {
  return value.trim().toLowerCase();
}

function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildModelAliases(model: Pick<OpenRouterModel, "id" | "name">): string[] {
  const aliases = new Set<string>();
  const id = normalizeModelRef(model.id);
  const name = normalizeModelRef(model.name);

  if (id) aliases.add(id);
  if (name) aliases.add(name);

  const nameSlug = slugifyName(model.name);
  if (nameSlug) aliases.add(nameSlug);

  const idNoProvider = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  if (idNoProvider) aliases.add(idNoProvider);

  const idNoSuffix = idNoProvider.includes(":")
    ? idNoProvider.slice(0, idNoProvider.indexOf(":"))
    : idNoProvider;
  if (idNoSuffix) aliases.add(idNoSuffix);

  const lastSegment = idNoSuffix.includes("/")
    ? idNoSuffix.slice(idNoSuffix.lastIndexOf("/") + 1)
    : idNoSuffix;
  if (lastSegment) aliases.add(lastSegment);

  return Array.from(aliases);
}

/**
 * Fetch all available models from OpenRouter.
 * The models list endpoint does not require authentication.
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: {
      "HTTP-Referer": "https://github.com/anthropics/foolery",
      "X-Title": "Foolery",
    },
  });

  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`);
  }

  const json: OpenRouterModelsResponse = await res.json();
  return json.data;
}

/**
 * Validate an OpenRouter API key by making a test request.
 * Uses the /auth/key endpoint to check key validity.
 */
export async function validateOpenRouterApiKey(
  apiKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${OPENROUTER_BASE}/auth/key`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Mask an API key for safe display. Returns empty string for empty keys. */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

/**
 * Format model pricing for display.
 * Converts per-token cost strings to per-million-token dollar amounts.
 */
export function formatPricing(perTokenCost: string): string {
  const cost = parseFloat(perTokenCost);
  if (isNaN(cost) || cost === 0) return "Free";
  const perMillion = cost * 1_000_000;
  if (perMillion < 0.01) return "<$0.01/M";
  return `$${perMillion.toFixed(2)}/M`;
}

/**
 * Resolve a user-provided model reference to an OpenRouter model.
 * Supports exact id/name matches plus common shorthand like "devstral".
 */
export function findOpenRouterModel(
  models: OpenRouterModel[],
  modelRef: string,
): OpenRouterModel | null {
  const key = normalizeModelRef(modelRef);
  if (!key) return null;

  // Exact alias match first.
  for (const model of models) {
    const aliases = buildModelAliases(model);
    if (aliases.includes(key)) return model;
  }

  // Then fuzzy containment for shorthand lookups.
  let best: { model: OpenRouterModel; score: number } | null = null;
  for (const model of models) {
    const aliases = buildModelAliases(model);
    const hasPartial = aliases.some(
      (alias) => alias.includes(key) || key.includes(alias),
    );
    if (!hasPartial) continue;
    const score = Math.min(
      ...aliases.map((alias) => Math.abs(alias.length - key.length)),
    );
    if (!best || score < best.score) {
      best = { model, score };
    }
  }

  return best?.model ?? null;
}

export interface OpenRouterPricingDisplay {
  modelId: string;
  prompt: string;
  completion: string;
}

/** Resolve and format prompt/completion pricing for a model reference. */
export function resolveOpenRouterPricing(
  models: OpenRouterModel[] | null | undefined,
  modelRef: string | undefined,
): OpenRouterPricingDisplay | null {
  if (!models || models.length === 0 || !modelRef) return null;
  const matched = findOpenRouterModel(models, modelRef);
  if (!matched) return null;
  return {
    modelId: matched.id,
    prompt: formatPricing(matched.pricing.prompt),
    completion: formatPricing(matched.pricing.completion),
  };
}
