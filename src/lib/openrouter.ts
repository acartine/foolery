/**
 * OpenRouter API client -- fetches available models and their pricing.
 *
 * API docs: https://openrouter.ai/docs/api-reference/list-available-models
 * Base URL: https://openrouter.ai/api/v1
 * Models endpoint: GET /api/v1/models (no auth required for listing)
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

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
