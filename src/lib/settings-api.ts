import type { BdResult, RegisteredAgent, ScannedAgent } from "./types";
import type { FoolerySettings, ActionAgentMappings, PoolsSettings } from "./schemas";

const SETTINGS_BASE = "/api/settings";

async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<BdResult<T>> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error ?? "Request failed" };
  }
  return { ok: true, data: json.data ?? json };
}

export function fetchSettings(): Promise<BdResult<FoolerySettings>> {
  return request<FoolerySettings>(SETTINGS_BASE);
}

export function saveSettings(
  settings: FoolerySettings,
): Promise<BdResult<FoolerySettings>> {
  return request<FoolerySettings>(SETTINGS_BASE, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/**
 * Partially update settings without clobbering unrelated sections.
 * Only the provided top-level keys (and their sub-fields) are merged;
 * omitted sections are left untouched on disk.
 */
export function patchSettings(
  partial: Partial<FoolerySettings>,
): Promise<BdResult<FoolerySettings>> {
  return request<FoolerySettings>(SETTINGS_BASE, {
    method: "PATCH",
    body: JSON.stringify(partial),
  });
}

export function fetchAgents(): Promise<
  BdResult<Record<string, RegisteredAgent>>
> {
  return request<Record<string, RegisteredAgent>>(
    `${SETTINGS_BASE}/agents`,
  );
}

export function addAgent(
  id: string,
  agent: RegisteredAgent,
): Promise<BdResult<Record<string, RegisteredAgent>>> {
  return request<Record<string, RegisteredAgent>>(
    `${SETTINGS_BASE}/agents`,
    {
      method: "POST",
      body: JSON.stringify({ id, ...agent }),
    },
  );
}

export function removeAgent(
  id: string,
): Promise<BdResult<Record<string, RegisteredAgent>>> {
  return request<Record<string, RegisteredAgent>>(
    `${SETTINGS_BASE}/agents`,
    {
      method: "DELETE",
      body: JSON.stringify({ id }),
    },
  );
}

export function scanAgents(): Promise<BdResult<ScannedAgent[]>> {
  return request<ScannedAgent[]>(`${SETTINGS_BASE}/agents/scan`);
}

export function fetchActions(): Promise<BdResult<ActionAgentMappings>> {
  return request<ActionAgentMappings>(`${SETTINGS_BASE}/actions`);
}

export function saveActions(
  actions: Partial<ActionAgentMappings>,
): Promise<BdResult<ActionAgentMappings>> {
  return request<ActionAgentMappings>(`${SETTINGS_BASE}/actions`, {
    method: "PUT",
    body: JSON.stringify(actions),
  });
}

export function fetchOpenRouterModels(): Promise<
  BdResult<import("./openrouter").OpenRouterModel[]>
> {
  return request<import("./openrouter").OpenRouterModel[]>("/api/openrouter/models");
}

export function validateOpenRouterKey(apiKey: string): Promise<BdResult<{ valid: boolean }>> {
  return request<{ valid: boolean }>("/api/openrouter/validate", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export function savePools(
  pools: Partial<PoolsSettings>,
): Promise<BdResult<FoolerySettings>> {
  return patchSettings({ pools } as Partial<FoolerySettings>);
}
