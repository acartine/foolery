import { parse, stringify } from "smol-toml";
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  readdir,
  stat,
} from "node:fs/promises";
import { exec } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";

const execAsync = promisify(exec);
import { join } from "node:path";
import { homedir } from "node:os";
import {
  foolerySettingsSchema,
  type FoolerySettings,
  type RegisteredAgentConfig,
  type PoolsSettings,
} from "@/lib/schemas";
import type {
  RegisteredAgent,
  ActionName,
  ScannedAgent,
  ScannedAgentOption,
} from "@/lib/types";
import type { AgentTarget, CliAgentTarget } from "@/lib/types-agent-target";
import { type WorkflowStep, isReviewStep, priorActionStep } from "@/lib/workflows";
import { resolvePoolAgent, getLastStepAgent, recordStepAgent } from "@/lib/agent-pool";
import {
  agentDisplayName,
  buildAgentOptionId,
  formatAgentOptionLabel,
  normalizeAgentIdentity,
  providerLabel,
} from "@/lib/agent-identity";

const CONFIG_DIR = join(homedir(), ".config", "foolery");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.toml");
const CACHE_TTL_MS = 30_000;
const DEFAULT_SETTINGS: FoolerySettings = foolerySettingsSchema.parse({});
const CODEX_CONFIG_FILE = join(homedir(), ".codex", "config.toml");
const CLAUDE_SETTINGS_FILE = join(homedir(), ".claude", "settings.json");
const GEMINI_SETTINGS_FILE = join(homedir(), ".gemini", "settings.json");
const GEMINI_TMP_ROOT = join(homedir(), ".gemini", "tmp");
const AGENT_MODEL_CATALOG_FILE = join(process.cwd(), "src", "lib", "agent-model-catalog.toml");

let cached: { value: FoolerySettings; loadedAt: number } | null = null;
let catalogCache:
  | Promise<Record<string, Array<{
      modelId: string;
      model?: string;
      flavor?: string;
      version?: string;
    }>>>
  | null = null;

interface SettingsDefaultsComputation {
  settings: FoolerySettings;
  merged: Record<string, unknown>;
  missingPaths: string[];
  normalizationChanged: boolean;
  fileMissing: boolean;
  error?: string;
}

export interface SettingsDefaultsAudit {
  settings: FoolerySettings;
  missingPaths: string[];
  fileMissing: boolean;
  error?: string;
}

export interface SettingsDefaultsBackfillResult extends SettingsDefaultsAudit {
  changed: boolean;
}

export interface SettingsPermissionsAudit {
  fileMissing: boolean;
  needsFix: boolean;
  actualMode?: number;
  error?: string;
}

export interface SettingsPermissionsFixResult extends SettingsPermissionsAudit {
  changed: boolean;
}

export interface StaleSettingsAudit {
  stalePaths: string[];
  fileMissing: boolean;
  error?: string;
}

export interface StaleSettingsCleanupResult extends StaleSettingsAudit {
  changed: boolean;
}

interface StaleSettingsComputation extends StaleSettingsAudit {
  cleaned: Record<string, unknown>;
}

const STALE_TOP_LEVEL_SETTINGS_KEYS = ["agent", "verification"] as const;
const STALE_ACTION_SETTINGS_KEYS = ["direct"] as const;
const LEGACY_DISPATCH_MODE_MAP = {
  actions: "basic",
  pools: "advanced",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLeafSettingPaths(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [path];
  const entries = Object.entries(value);
  // Empty object defaults (for map-style settings) have no required leaf keys.
  if (entries.length === 0) return [];
  return entries.flatMap(([key, nested]) =>
    collectLeafSettingPaths(nested, `${path}.${key}`),
  );
}

function mergeMissingDefaults(
  current: unknown,
  defaults: Record<string, unknown>,
  prefix = "",
): { merged: Record<string, unknown>; missingPaths: string[] } {
  const source = isRecord(current) ? current : {};
  const merged: Record<string, unknown> = isRecord(current)
    ? { ...current }
    : {};
  const missingPaths: string[] = [];

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const hasKey = Object.prototype.hasOwnProperty.call(source, key);
    const currentValue = source[key];

    if (!hasKey || currentValue === undefined) {
      merged[key] = defaultValue;
      missingPaths.push(...collectLeafSettingPaths(defaultValue, path));
      continue;
    }

    if (isRecord(defaultValue) && isRecord(currentValue)) {
      const nested = mergeMissingDefaults(currentValue, defaultValue, path);
      merged[key] = nested.merged;
      missingPaths.push(...nested.missingPaths);
      continue;
    }

    merged[key] = currentValue;
  }

  return {
    merged,
    missingPaths: Array.from(new Set(missingPaths)),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeMode(mode: number): number {
  return mode & 0o777;
}

function normalizeLegacyDispatchModeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return LEGACY_DISPATCH_MODE_MAP[value as keyof typeof LEGACY_DISPATCH_MODE_MAP] ?? value;
}

function normalizeLegacySettings(current: unknown): Record<string, unknown> {
  const normalized = structuredClone(isRecord(current) ? current : {}) as Record<string, unknown>;
  normalized.dispatchMode = normalizeLegacyDispatchModeValue(normalized.dispatchMode);
  return normalized;
}

async function readRawSettings(): Promise<{
  parsed: unknown;
  fileMissing: boolean;
  error?: string;
}> {
  let raw: string;
  try {
    raw = await readFile(SETTINGS_FILE, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { parsed: {}, fileMissing: true };
    }
    return { parsed: {}, fileMissing: false, error: formatError(error) };
  }

  try {
    return { parsed: normalizeLegacySettings(parse(raw)), fileMissing: false };
  } catch (error) {
    return { parsed: {}, fileMissing: false, error: formatError(error) };
  }
}

function removeStaleSettingsKeys(current: unknown): {
  cleaned: Record<string, unknown>;
  stalePaths: string[];
} {
  const cleaned = structuredClone(isRecord(current) ? current : {}) as Record<string, unknown>;
  const stalePaths: string[] = [];

  for (const key of STALE_TOP_LEVEL_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      delete cleaned[key];
      stalePaths.push(key);
    }
  }

  if (isRecord(cleaned.actions)) {
    for (const key of STALE_ACTION_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(cleaned.actions, key)) {
        delete cleaned.actions[key];
        stalePaths.push(`actions.${key}`);
      }
    }
  }

  return {
    cleaned,
    stalePaths: Array.from(new Set(stalePaths)),
  };
}

async function computeSettingsDefaultsStatus(): Promise<SettingsDefaultsComputation> {
  const raw = await readRawSettings();
  if (raw.error) {
    return {
      settings: DEFAULT_SETTINGS,
      merged: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      missingPaths: [],
      normalizationChanged: false,
      fileMissing: raw.fileMissing,
      error: raw.error,
    };
  }

  const { merged, missingPaths } = mergeMissingDefaults(
    raw.parsed,
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
  );

  try {
    const settings = foolerySettingsSchema.parse(merged);
    const normalized = settings as unknown as Record<string, unknown>;
    return {
      settings,
      merged: normalized,
      missingPaths,
      normalizationChanged: !isDeepStrictEqual(normalized, merged),
      fileMissing: raw.fileMissing,
    };
  } catch (error) {
    return {
      settings: DEFAULT_SETTINGS,
      merged: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      missingPaths: [],
      normalizationChanged: false,
      fileMissing: raw.fileMissing,
      error: formatError(error),
    };
  }
}

async function computeStaleSettingsStatus(): Promise<StaleSettingsComputation> {
  const raw = await readRawSettings();
  if (raw.error) {
    return {
      cleaned: {},
      stalePaths: [],
      fileMissing: raw.fileMissing,
      error: raw.error,
    };
  }

  const { cleaned, stalePaths } = removeStaleSettingsKeys(raw.parsed);
  return {
    cleaned,
    stalePaths,
    fileMissing: raw.fileMissing,
  };
}

/** Inspect whether settings.toml is missing any known defaults. */
export async function inspectSettingsDefaults(): Promise<SettingsDefaultsAudit> {
  const result = await computeSettingsDefaultsStatus();
  return {
    settings: result.settings,
    missingPaths: result.missingPaths,
    fileMissing: result.fileMissing,
    error: result.error,
  };
}

/** Inspect whether settings.toml still contains known stale keys from v0.3.0. */
export async function inspectStaleSettingsKeys(): Promise<StaleSettingsAudit> {
  const result = await computeStaleSettingsStatus();
  return {
    stalePaths: result.stalePaths,
    fileMissing: result.fileMissing,
    error: result.error,
  };
}

/**
 * Backfill missing defaults into settings.toml without overwriting existing values.
 * Writes only when file is missing or expected keys are absent.
 */
export async function backfillMissingSettingsDefaults(): Promise<SettingsDefaultsBackfillResult> {
  const result = await computeSettingsDefaultsStatus();
  let changed = false;

  if (
    !result.error &&
    (result.fileMissing || result.missingPaths.length > 0 || result.normalizationChanged)
  ) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, stringify(result.merged), "utf-8");
    await chmod(SETTINGS_FILE, 0o600);
    changed = true;
  }

  cached = { value: result.settings, loadedAt: Date.now() };
  return {
    settings: result.settings,
    missingPaths: result.missingPaths,
    fileMissing: result.fileMissing,
    error: result.error,
    changed,
  };
}

export async function inspectSettingsPermissions(): Promise<SettingsPermissionsAudit> {
  try {
    const info = await stat(SETTINGS_FILE);
    const actualMode = normalizeMode(info.mode);
    return {
      fileMissing: false,
      needsFix: actualMode !== 0o600,
      actualMode,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        fileMissing: true,
        needsFix: false,
      };
    }
    return {
      fileMissing: false,
      needsFix: false,
      error: formatError(error),
    };
  }
}

export async function ensureSettingsPermissions(): Promise<SettingsPermissionsFixResult> {
  const result = await inspectSettingsPermissions();
  if (result.error || result.fileMissing || !result.needsFix) {
    return {
      ...result,
      changed: false,
    };
  }

  await chmod(SETTINGS_FILE, 0o600);
  return {
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
    changed: true,
  };
}

/** Remove obsolete settings keys that are no longer used by the app. */
export async function cleanStaleSettingsKeys(): Promise<StaleSettingsCleanupResult> {
  const result = await computeStaleSettingsStatus();
  let changed = false;

  if (!result.error && result.stalePaths.length > 0) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, stringify(result.cleaned), "utf-8");
    await chmod(SETTINGS_FILE, 0o600);
    changed = true;
  }

  cached = null;
  return {
    stalePaths: result.stalePaths,
    fileMissing: result.fileMissing,
    error: result.error,
    changed,
  };
}

function resolveCatalogBackedAgent(
  agentId: string,
  agent: RegisteredAgentConfig,
  catalog: Record<string, AgentCatalogOption[]>,
): RegisteredAgentConfig {
  const normalized = normalizeAgentIdentity(agent);
  const rawModel = agent.model?.trim().toLowerCase();
  const normalizedModel = normalized.model?.trim().toLowerCase();
  const normalizedFlavor = normalized.flavor?.trim().toLowerCase();

  const matched = (catalog[agentId] ?? []).find((option) => {
    const optionModelId = option.modelId.trim().toLowerCase();
    const optionModel = option.model?.trim().toLowerCase();
    const optionFlavor = option.flavor?.trim().toLowerCase();
    return (
      optionModelId === rawModel ||
      (optionModel && optionModel === normalizedModel && optionFlavor === normalizedFlavor) ||
      (optionFlavor && optionFlavor === rawModel) ||
      (optionFlavor && optionFlavor === normalizedFlavor)
    );
  });

  return {
    ...agent,
    ...(normalized.provider ? { provider: normalized.provider } : {}),
    ...(normalized.flavor ?? matched?.flavor
      ? { flavor: normalized.flavor ?? matched?.flavor }
      : {}),
    ...(normalized.version ?? matched?.version
      ? { version: normalized.version ?? matched?.version }
      : {}),
  };
}

async function resolveCatalogBackedAgents(
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

/**
 * Load settings from ~/.config/foolery/settings.toml.
 * Returns validated settings with defaults filled in.
 * Uses a 30-second TTL cache to avoid redundant disk reads.
 */
export async function loadSettings(): Promise<FoolerySettings> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const result = await computeSettingsDefaultsStatus();
  const resolved = await resolveCatalogBackedAgents(result.settings);
  cached = { value: resolved, loadedAt: Date.now() };
  return resolved;
}

/**
 * Write the full settings object to disk as TOML.
 * Creates the config directory if it doesn't exist.
 */
export async function saveSettings(
  settings: FoolerySettings,
): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const toml = stringify(settings);
  await writeFile(SETTINGS_FILE, toml, "utf-8");
  await chmod(SETTINGS_FILE, 0o600);
  cached = { value: settings, loadedAt: Date.now() };
}

/** Partial shape accepted by updateSettings for deep merging. */
export type SettingsPartial = Partial<{
  agents: FoolerySettings["agents"];
  actions: Partial<FoolerySettings["actions"]>;
  backend: Partial<FoolerySettings["backend"]>;
  defaults: Partial<FoolerySettings["defaults"]>;
  pools: Partial<FoolerySettings["pools"]>;
  dispatchMode: FoolerySettings["dispatchMode"];
  maxConcurrentSessions: FoolerySettings["maxConcurrentSessions"];
}>;

/**
 * Merge a partial update into the current settings, save, and return the result.
 * Each top-level section is only touched when explicitly provided in `partial`,
 * so sending `{ pools: { ... } }` will never clobber agent/action config.
 */
export async function updateSettings(
  partial: SettingsPartial,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const merged: FoolerySettings = {
    ...current,
    agents:       partial.agents       !== undefined ? { ...current.agents,       ...partial.agents }       : current.agents,
    actions:      partial.actions      !== undefined ? { ...current.actions,      ...partial.actions }      : current.actions,
    backend:      partial.backend      !== undefined ? { ...current.backend,      ...partial.backend }      : current.backend,
    defaults:     partial.defaults     !== undefined ? { ...current.defaults,     ...partial.defaults }     : current.defaults,
    pools:        partial.pools        !== undefined ? { ...current.pools,        ...partial.pools }        : current.pools,
    dispatchMode: partial.dispatchMode !== undefined ? partial.dispatchMode                                 : current.dispatchMode,
    maxConcurrentSessions: partial.maxConcurrentSessions !== undefined ? partial.maxConcurrentSessions      : current.maxConcurrentSessions,
  };
  const validated = foolerySettingsSchema.parse(merged);
  await saveSettings(validated);
  return validated;
}

/** Returns fallback command: first registered agent, or "claude" if none exist. */
function getFallbackCommand(settings: FoolerySettings): string {
  const first = Object.values(settings.agents)[0];
  return first?.command ?? "claude";
}

function toCliTarget(
  agent: RegisteredAgentConfig | RegisteredAgent,
  agentId?: string,
): CliAgentTarget {
  const normalized = normalizeAgentIdentity(agent);
  return {
    kind: "cli",
    command: agent.command,
    ...(agent.model ? { model: agent.model } : {}),
    ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
    ...(normalized.version ? { version: normalized.version } : {}),
    ...((agent.label ?? agentDisplayName(agent))
      ? { label: agent.label ?? agentDisplayName(agent) }
      : {}),
    ...(agentId ? { agentId } : {}),
  };
}

/** Returns the dispatch fallback command for unmapped actions/steps. */
export async function getAgentCommand(): Promise<string> {
  const settings = await loadSettings();
  return getFallbackCommand(settings);
}

/** Returns the registered agents map. */
export async function getRegisteredAgents(): Promise<
  Record<string, RegisteredAgentConfig>
> {
  const settings = await loadSettings();
  return Object.fromEntries(
    Object.entries(settings.agents).map(([id, agent]) => {
      const normalized = normalizeAgentIdentity(agent);
      return [
        id,
        {
          ...agent,
          ...(normalized.provider ? { provider: normalized.provider } : {}),
          ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
          ...(normalized.version ? { version: normalized.version } : {}),
          ...(agent.label ? { label: agent.label } : {}),
        },
      ];
    }),
  );
}

/** Resolves an action name to its agent config. Falls back to dispatch default. */
export async function getActionAgent(
  action: ActionName,
): Promise<AgentTarget> {
  const settings = await loadSettings();
  const agentId = settings.actions[action] ?? "";
  if (agentId && agentId !== "default" && settings.agents[agentId]) {
    return toCliTarget(settings.agents[agentId], agentId);
  }
  return toCliTarget({ command: getFallbackCommand(settings) });
}

/**
 * Resolve the backend type to use. Priority:
 * 1. FOOLERY_BACKEND environment variable
 * 2. settings.toml backend.type
 * 3. Default: "cli"
 */
export async function getBackendType(): Promise<string> {
  const envType = process.env.FOOLERY_BACKEND;
  if (envType) return envType;
  const settings = await loadSettings();
  return settings.backend.type;
}

/** Adds or updates a registered agent. */
export async function addRegisteredAgent(
  id: string,
  agent: RegisteredAgent,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const normalized = normalizeAgentIdentity(agent);
  const agents = {
    ...current.agents,
    [id]: {
      command: agent.command,
      ...(agent.model ? { model: agent.model } : {}),
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
      ...(agent.label || normalized.provider ? { label: agent.label ?? normalized.provider } : {}),
    },
  };
  return updateSettings({ agents });
}

/** Removes a registered agent by id. */
export async function removeRegisteredAgent(
  id: string,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const remaining = Object.fromEntries(
    Object.entries(current.agents).filter(([key]) => key !== id),
  );
  const updated: FoolerySettings = { ...current, agents: remaining };
  const validated = foolerySettingsSchema.parse(updated);
  await saveSettings(validated);
  return validated;
}

interface ScannableAgent {
  id: string;
  command: string;
}

interface AgentCatalogOption {
  modelId: string;
  model?: string;
  flavor?: string;
  version?: string;
}

async function loadAgentModelCatalog(): Promise<Record<string, AgentCatalogOption[]>> {
  if (!catalogCache) {
    catalogCache = readFile(AGENT_MODEL_CATALOG_FILE, "utf-8")
      .then((raw) => {
        const parsed = parse(raw) as Record<string, unknown>;
        const result: Record<string, AgentCatalogOption[]> = {};
        for (const [agentId, entry] of Object.entries(parsed)) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
          const options = "options" in entry ? (entry.options as unknown) : undefined;
          if (!Array.isArray(options)) continue;
          result[agentId] = options
            .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object" && !Array.isArray(option))
            .map((option) => ({
              modelId: typeof option.model_id === "string" ? option.model_id : "",
              ...(typeof option.model === "string" ? { model: option.model } : {}),
              ...(typeof option.flavor === "string" ? { flavor: option.flavor } : {}),
              ...(typeof option.version === "string" ? { version: option.version } : {}),
            }))
            .filter((option) => option.modelId);
        }
        return result;
      })
      .catch(() => ({}));
  }
  return catalogCache;
}

function dedupeScannedOptions(
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
  const deduped: NonNullable<ScannedAgent["options"]> = [];
  for (const option of options) {
    const id = buildAgentOptionId(agentId, option);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push({
      ...option,
      id,
      label: formatAgentOptionLabel(option),
    });
  }
  return deduped;
}

async function buildAgentImportOptions(
  agentId: string,
  detected: Pick<ScannedAgent, "provider" | "model" | "flavor" | "version" | "modelId">,
): Promise<ScannedAgent["options"]> {
  const catalog = await loadAgentModelCatalog();
  const provider = providerLabel(detected.provider, agentId);
  const catalogOptions = (catalog[agentId] ?? []).map((option) => ({
    provider,
    ...option,
  }));
  const detectedOption = detected.modelId
    ? [{
        provider,
        ...(detected.model ? { model: detected.model } : {}),
        ...(detected.flavor ? { flavor: detected.flavor } : {}),
        ...(detected.version ? { version: detected.version } : {}),
        modelId: detected.modelId,
      }]
    : [];

  const matchedCatalogIndex = detected.modelId
    ? catalogOptions.findIndex((option) => option.modelId === detected.modelId)
    : -1;

  if (matchedCatalogIndex >= 0) {
    const matched = catalogOptions[matchedCatalogIndex]!;
    const ordered = [
      matched,
      ...catalogOptions.filter((_, index) => index !== matchedCatalogIndex),
    ];
    return dedupeScannedOptions(agentId, ordered);
  }

  if (detectedOption.length > 0) {
    return dedupeScannedOptions(agentId, [...detectedOption, ...catalogOptions]);
  }

  if (catalogOptions.length > 0) {
    return dedupeScannedOptions(agentId, catalogOptions);
  }

  if (provider) {
    return dedupeScannedOptions(agentId, [{ provider }]);
  }

  return [];
}

const SCANNABLE_AGENTS: readonly ScannableAgent[] = [
  { id: "claude", command: "claude" },
  { id: "codex", command: "codex" },
  { id: "gemini", command: "gemini" },
  { id: "opencode", command: "opencode" },
] as const;

async function readCodexConfiguredModel(): Promise<string | undefined> {
  try {
    const raw = await readFile(CODEX_CONFIG_FILE, "utf-8");
    const parsed = parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "model" in parsed &&
      typeof parsed.model === "string"
    ) {
      return parsed.model;
    }
  } catch {
    // ignore missing config
  }
  return undefined;
}

function findStringField(
  value: unknown,
  keys: ReadonlySet<string>,
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringField(entry, keys);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
    const nested = findStringField(entry, keys);
    if (nested) return nested;
  }
  return undefined;
}

async function readClaudeConfiguredModel(): Promise<string | undefined> {
  try {
    const raw = await readFile(CLAUDE_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return findStringField(
      parsed,
      new Set(["model", "defaultModel", "primaryModel"]),
    );
  } catch {
    return undefined;
  }
}

async function readGeminiConfiguredModel(): Promise<string | undefined> {
  try {
    const raw = await readFile(GEMINI_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const direct = findStringField(parsed, new Set(["model", "defaultModel", "selectedModel"]));
    if (direct) return direct;
  } catch {
    // ignore
  }

  try {
    const roots = await readdir(GEMINI_TMP_ROOT);
    let newest: { path: string; mtimeMs: number } | null = null;
    for (const root of roots) {
      const chatsDir = join(GEMINI_TMP_ROOT, root, "chats");
      let entries: string[];
      try {
        entries = await readdir(chatsDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const filePath = join(chatsDir, entry);
        try {
          const details = await stat(filePath);
          if (!newest || details.mtimeMs > newest.mtimeMs) {
            newest = { path: filePath, mtimeMs: details.mtimeMs };
          }
        } catch {
          // ignore
        }
      }
    }

    if (!newest) return undefined;
    const raw = await readFile(newest.path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return findStringField(parsed, new Set(["model", "modelId"]));
  } catch {
    return undefined;
  }
}

/** Read available models from `opencode models`. */
async function readOpenCodeModels(): Promise<ScannedAgentOption[]> {
  try {
    const { stdout } = await execAsync("opencode models", { timeout: 10_000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      const modelId = line.trim();
      return {
        id: `opencode-${modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
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

async function resolveInstalledAgentCommand(
  agent: ScannableAgent,
): Promise<{ command: string; path: string } | null> {
  try {
    const { stdout } = await execAsync(`command -v ${agent.command}`);
    const installedPath = stdout.trim();
    if (installedPath) {
      return { command: agent.command, path: installedPath };
    }
  } catch {
    return null;
  }
  return null;
}

async function inspectInstalledAgentMetadata(
  agent: ScannableAgent,
  resolvedCommand: string,
): Promise<Pick<ScannedAgent, "provider" | "model" | "flavor" | "version" | "modelId">> {
  const provider = providerLabel(undefined, resolvedCommand);
  if (agent.id === "codex") {
    const modelId = await readCodexConfiguredModel();
    const normalized = normalizeAgentIdentity({
      command: resolvedCommand,
      provider,
      model: modelId,
    });
    return {
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
      ...(modelId ? { modelId } : {}),
    };
  }
  if (agent.id === "claude") {
    const modelId = await readClaudeConfiguredModel();
    const normalized = normalizeAgentIdentity({
      command: resolvedCommand,
      provider,
      model: modelId,
    });
    return {
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
      ...(modelId ? { modelId } : {}),
    };
  }
  if (agent.id === "gemini") {
    const modelId = await readGeminiConfiguredModel();
    const normalized = normalizeAgentIdentity({
      command: resolvedCommand,
      provider,
      model: modelId,
    });
    return {
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
      ...(modelId ? { modelId } : {}),
    };
  }
  if (agent.id === "opencode") {
    const models = await readOpenCodeModels();
    const first = models[0];
    return {
      provider: "OpenCode",
      ...(first?.model ? { model: first.model } : {}),
      ...(first?.modelId ? { modelId: first.modelId } : {}),
    };
  }
  const normalized = normalizeAgentIdentity({
    command: resolvedCommand,
    provider,
  });
  return {
    ...(normalized.provider ? { provider: normalized.provider } : {}),
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
    ...(normalized.version ? { version: normalized.version } : {}),
  };
}

/** Scans PATH for known agent CLIs and returns what was found. */
export async function scanForAgents(): Promise<ScannedAgent[]> {
  const results = await Promise.all(
    SCANNABLE_AGENTS.map(async (agent): Promise<ScannedAgent> => {
      const installed = await resolveInstalledAgentCommand(agent);
      if (installed) {
        const metadata = await inspectInstalledAgentMetadata(
          agent,
          installed.command,
        );
        let options: ScannedAgent["options"];
        if (agent.id === "opencode") {
          // OpenCode uses dynamic model discovery
          const models = await readOpenCodeModels();
          options = models.length > 0 ? models : await buildAgentImportOptions(agent.id, metadata);
        } else {
          options = await buildAgentImportOptions(agent.id, metadata);
        }
        return {
          id: agent.id,
          command: installed.command,
          path: installed.path,
          installed: true,
          ...metadata,
          options,
          selectedOptionId: options?.[0]?.id,
        };
      }
      const provider = providerLabel(undefined, agent.command);
      const options = await buildAgentImportOptions(agent.id, { provider });
      return {
        id: agent.id,
        command: agent.command,
        path: "",
        installed: false,
        ...(provider ? { provider } : {}),
        options,
      };
    }),
  );
  return results;
}

/** Returns the pools settings. */
export async function getPoolsSettings(): Promise<PoolsSettings> {
  const settings = await loadSettings();
  return settings.pools;
}

/**
 * Resolve an agent for a workflow step using pool configuration.
 * Falls back to the given action's agent mapping if no pool is configured,
 * then to the dispatch fallback command.
 *
 * Cross-agent review: for review steps (plan_review, implementation_review,
 * shipment_review), if we know which agent executed the preceding action step
 * for the same beat, we exclude that agent from pool selection so a different
 * agent performs the review. If no alternative is available, the same agent
 * is used and a warning is logged.
 *
 * @param beatId - Beat ID for per-beat agent tracking (optional).
 */
export async function getStepAgent(
  step: WorkflowStep,
  fallbackAction?: ActionName,
  beatId?: string,
): Promise<AgentTarget> {
  const settings = await loadSettings();

  // Only use pools when dispatch mode is "advanced"
  if (settings.dispatchMode === "advanced") {
    const poolAgents: Record<string, RegisteredAgentConfig> = {
      ...settings.agents,
    };

    // Derive exclusion for cross-agent review
    let excludeAgentId: string | undefined;
    if (beatId && isReviewStep(step)) {
      const actionStep = priorActionStep(step);
      if (actionStep) {
        excludeAgentId = getLastStepAgent(beatId, actionStep);
      }
    }

    console.log(
      `[getStepAgent] step="${step}" dispatchMode="advanced" beatId=${beatId ?? "n/a"} ` +
      `fallbackAction=${fallbackAction ?? "n/a"} excludeAgentId=${excludeAgentId ?? "none"} ` +
      `registeredAgents=[${Object.keys(poolAgents).join(", ")}]`,
    );
    const poolAgent = resolvePoolAgent(
      step,
      settings.pools,
      poolAgents,
      excludeAgentId,
    );
    if (poolAgent) {
      // Record this selection for future cross-agent review lookups
      if (beatId && poolAgent.agentId) {
        recordStepAgent(beatId, step, poolAgent.agentId);
      }
      console.log(
        `[getStepAgent] step="${step}" => pool selection: agentId=${poolAgent.agentId ?? "n/a"} ` +
        `kind=${poolAgent.kind} command=${poolAgent.command} model=${poolAgent.model ?? "n/a"}`,
      );
      return poolAgent;
    }
    console.log(`[getStepAgent] step="${step}" pool returned null, falling back to action mapping`);
  }

  // Fall back to action mapping
  if (fallbackAction) {
    const agentId = settings.actions[fallbackAction] ?? "";
    if (agentId && agentId !== "default" && settings.agents[agentId]) {
      return toCliTarget(settings.agents[agentId], agentId);
    }
  }

  // Fall back to dispatch default
  return toCliTarget({ command: getFallbackCommand(settings) });
}

/** Reset the in-memory cache (useful for testing). */
export function _resetCache(): void {
  cached = null;
}
