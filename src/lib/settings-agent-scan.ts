/**
 * Dynamic model discovery and import-options builder.
 *
 * CLIs that support model listing (copilot, opencode) are
 * queried at scan time. Others fall back to config-file
 * detection only.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ScannedAgent, ScannedAgentOption } from "@/lib/types";
import {
  normalizeAgentIdentity,
  providerLabel,
  buildAgentOptionId,
  formatAgentOptionLabel,
} from "@/lib/agent-identity";

const execAsync = promisify(exec);

const STATIC_PROVIDER_MODEL_IDS: Partial<
  Record<string, readonly string[]>
> = {
  claude: [
    "claude-sonnet-4.6",
    "claude-opus-4.6",
    "claude-sonnet-4.5",
    "claude-haiku-4.5",
    "claude-opus-4.5",
  ],
  codex: [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
  ],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
};

// ── Dynamic model readers ───────────────────────────────────

export async function readOpenCodeModels(): Promise<
  ScannedAgentOption[]
> {
  try {
    const { stdout } = await execAsync(
      "opencode models", { timeout: 10_000 },
    );
    return stdout.trim().split("\n")
      .filter(Boolean)
      .map((line) => {
        const modelId = line.trim();
        const slug = modelId.toLowerCase()
          .replace(/[^a-z0-9]+/g, "-");
        return {
          id: `opencode-${slug}`,
          label: modelId,
          provider: "OpenCode",
          model: modelId,
          modelId,
        };
      });
  } catch {
    return [];
  }
}

// Display-only credit multipliers for Copilot models.
// Models discovered dynamically; this only annotates
// known ones with their cost. Source:
// docs.github.com/en/copilot/concepts/billing/copilot-requests
const COPILOT_CREDITS: Record<string, number> = {
  "claude-sonnet-4.6": 1,
  "claude-sonnet-4.5": 1,
  "claude-haiku-4.5": 0.33,
  "claude-opus-4.6": 3,
  "claude-opus-4.6-fast": 30,
  "claude-opus-4.5": 3,
  "claude-sonnet-4": 1,
  "gemini-3-pro-preview": 1,
  "gpt-5.4": 1,
  "gpt-5.3-codex": 1,
  "gpt-5.2-codex": 1,
  "gpt-5.2": 1,
  "gpt-5.1-codex-max": 1,
  "gpt-5.1-codex": 1,
  "gpt-5.1": 1,
  "gpt-5.4-mini": 0.33,
  "gpt-5.1-codex-mini": 0.33,
  "gpt-5-mini": 0,
  "gpt-4.1": 0,
};

/**
 * Parse `copilot help config` output for available
 * models. The `model` config key lists them as:
 *   `model`: description...
 *     - "model-id-1"
 *     - "model-id-2"
 */
export async function readCopilotModels(): Promise<
  ScannedAgentOption[]
> {
  try {
    const { stdout } = await execAsync(
      "copilot help config", { timeout: 10_000 },
    );
    const lines = stdout.split("\n");
    let inModelSection = false;
    const modelIds: string[] = [];
    for (const line of lines) {
      if (!inModelSection) {
        if (/^\s*`model`:/.test(line)) {
          inModelSection = true;
        }
        continue;
      }
      const m = line.match(/^\s+-\s+"(.+)"$/);
      if (m) { modelIds.push(m[1]!); continue; }
      if (/^\s*`\w/.test(line) || line.trim() === "") {
        break;
      }
    }
    return modelIds.map((modelId) => {
      const n = normalizeAgentIdentity({
        command: "copilot", model: modelId,
      });
      const credits = COPILOT_CREDITS[modelId];
      return {
        id: buildAgentOptionId("copilot", {
          ...n, modelId,
        }),
        label: formatAgentOptionLabel({
          ...n, modelId,
        }),
        provider: n.provider,
        model: n.model,
        flavor: n.flavor,
        version: n.version,
        modelId,
        ...(credits !== undefined
          ? { credits } : {}),
      };
    });
  } catch {
    return [];
  }
}

export async function readDynamicModels(
  agentId: string,
): Promise<ScannedAgentOption[]> {
  if (agentId === "opencode") return readOpenCodeModels();
  if (agentId === "copilot") return readCopilotModels();
  return [];
}

// ── Import options builder ──────────────────────────────────

export function dedupeScannedOptions(
  agentId: string,
  options: Array<{
    provider?: string;
    model?: string;
    flavor?: string;
    version?: string;
    modelId?: string;
  }>,
): ScannedAgent["options"] {
  const seen = new Set<string>();
  const deduped: NonNullable<
    ScannedAgent["options"]
  > = [];
  for (const option of options) {
    const id = buildAgentOptionId(agentId, option);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push({
      ...option, id,
      label: formatAgentOptionLabel(option),
    });
  }
  return deduped;
}

function buildStaticProviderCatalog(
  agentId: string,
  provider?: string,
): ScannedAgentOption[] {
  const modelIds = STATIC_PROVIDER_MODEL_IDS[agentId];
  if (!modelIds || modelIds.length === 0) {
    return [];
  }

  return modelIds.map((modelId) => {
    const normalized = normalizeAgentIdentity({
      command: agentId,
      provider,
      model: modelId,
    });
    return {
      id: buildAgentOptionId(agentId, {
        ...normalized,
        modelId,
      }),
      label: formatAgentOptionLabel({
        ...normalized,
        modelId,
      }),
      provider: normalized.provider,
      model: normalized.model,
      flavor: normalized.flavor,
      version: normalized.version,
      modelId,
    };
  });
}

export function buildAgentImportOptions(
  agentId: string,
  detected: Pick<
    ScannedAgent,
    | "provider" | "model" | "flavor"
    | "version" | "modelId"
  >,
  dynamicModels?: ScannedAgentOption[],
): ScannedAgent["options"] {
  const provider = providerLabel(
    detected.provider, agentId,
  );
  const staticCatalog =
    buildStaticProviderCatalog(
      agentId,
      provider,
    );
  const detectedOption = detected.modelId
    ? [{
        provider,
        ...(detected.model
          ? { model: detected.model } : {}),
        ...(detected.flavor
          ? { flavor: detected.flavor } : {}),
        ...(detected.version
          ? { version: detected.version } : {}),
        modelId: detected.modelId,
      }]
    : [];

  if (
    detectedOption.length > 0 ||
    (dynamicModels && dynamicModels.length > 0) ||
    staticCatalog.length > 0
  ) {
    return dedupeScannedOptions(agentId, [
      ...detectedOption,
      ...(dynamicModels ?? []),
      ...staticCatalog,
    ]);
  }
  if (provider) {
    return dedupeScannedOptions(
      agentId, [{ provider }],
    );
  }
  return [];
}
