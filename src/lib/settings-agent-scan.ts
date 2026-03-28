import { parse } from "smol-toml";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FoolerySettings,
  RegisteredAgentConfig,
} from "@/lib/schemas";
import { normalizeAgentIdentity } from "@/lib/agent-identity";

const AGENT_MODEL_CATALOG_FILE = join(
  process.cwd(),
  "src",
  "lib",
  "agent-model-catalog.toml",
);

// ── Catalog types & cache ────────────────────────────────────

export interface AgentCatalogOption {
  modelId: string;
  provider?: string;
  model?: string;
  flavor?: string;
  version?: string;
}

let catalogCache: Promise<
  Record<string, AgentCatalogOption[]>
> | null = null;

export async function loadAgentModelCatalog(): Promise<
  Record<string, AgentCatalogOption[]>
> {
  if (!catalogCache) {
    catalogCache = readFile(AGENT_MODEL_CATALOG_FILE, "utf-8")
      .then((raw) => parseCatalogFile(raw))
      .catch(() => ({}));
  }
  return catalogCache;
}

function isValidCatalogEntry(
  option: unknown,
): option is Record<string, unknown> {
  return (
    Boolean(option) &&
    typeof option === "object" &&
    !Array.isArray(option)
  );
}

function parseCatalogFile(
  raw: string,
): Record<string, AgentCatalogOption[]> {
  const parsed = parse(raw) as Record<string, unknown>;
  const result: Record<string, AgentCatalogOption[]> = {};
  for (const [agentId, entry] of Object.entries(parsed)) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry)
    ) {
      continue;
    }
    const options =
      "options" in entry ? (entry.options as unknown) : undefined;
    if (!Array.isArray(options)) continue;
    result[agentId] = options
      .filter(isValidCatalogEntry)
      .map((option) => ({
        modelId:
          typeof option.model_id === "string"
            ? option.model_id
            : "",
        ...(typeof option.provider === "string"
          ? { provider: option.provider }
          : {}),
        ...(typeof option.model === "string"
          ? { model: option.model }
          : {}),
        ...(typeof option.flavor === "string"
          ? { flavor: option.flavor }
          : {}),
        ...(typeof option.version === "string"
          ? { version: option.version }
          : {}),
      }))
      .filter((option) => option.modelId);
  }
  return result;
}

// ── Catalog-backed agent resolution ──────────────────────────

export function resolveCatalogBackedAgent(
  agentId: string,
  agent: RegisteredAgentConfig,
  catalog: Record<string, AgentCatalogOption[]>,
): RegisteredAgentConfig {
  const normalized = normalizeAgentIdentity(agent);
  const rawModel = agent.model?.trim().toLowerCase();
  const normalizedModel = normalized.model?.trim().toLowerCase();
  const normalizedFlavor = normalized.flavor
    ?.trim()
    .toLowerCase();

  const matched = (catalog[agentId] ?? []).find((option) => {
    const optionModelId = option.modelId.trim().toLowerCase();
    const optionModel = option.model?.trim().toLowerCase();
    const optionFlavor = option.flavor?.trim().toLowerCase();
    return (
      optionModelId === rawModel ||
      (optionModel &&
        optionModel === normalizedModel &&
        optionFlavor === normalizedFlavor) ||
      (optionFlavor && optionFlavor === rawModel) ||
      (optionFlavor && optionFlavor === normalizedFlavor)
    );
  });

  return {
    ...agent,
    ...(normalized.provider ?? matched?.provider
      ? { provider: normalized.provider ?? matched?.provider }
      : {}),
    ...(normalized.flavor ?? matched?.flavor
      ? { flavor: normalized.flavor ?? matched?.flavor }
      : {}),
    ...(normalized.version ?? matched?.version
      ? { version: normalized.version ?? matched?.version }
      : {}),
  };
}

export async function resolveCatalogBackedAgents(
  settings: FoolerySettings,
): Promise<FoolerySettings> {
  const catalog = await loadAgentModelCatalog();
  return {
    ...settings,
    agents: Object.fromEntries(
      Object.entries(settings.agents).map(([agentId, agent]) => [
        agentId,
        resolveCatalogBackedAgent(agentId, agent, catalog),
      ]),
    ),
  };
}

// ── Re-export scanForAgents from detect module ───────────────

export { scanForAgents } from "@/lib/settings-agent-detect";
