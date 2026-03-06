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
  type OpenRouterSettings,
  type PoolsSettings,
} from "@/lib/schemas";
import { keychainSet, keychainGet, keychainDelete } from "@/lib/keychain";
import {
  OPENROUTER_SELECTED_AGENT_ID,
  formatOpenRouterSelectedAgentLabel,
  getSelectedOpenRouterModel,
  openrouterAgentId,
  isOpenRouterAgentId,
  openrouterAgentKey,
  formatOpenRouterAgentLabel,
  listUniqueOpenRouterAgentKeys,
} from "@/lib/openrouter";
import type {
  RegisteredAgent,
  ActionName,
  ScannedAgent,
} from "@/lib/types";
import type { AgentTarget, CliAgentTarget, OpenRouterAgentTarget } from "@/lib/types-agent-target";
import { type WorkflowStep, isReviewStep, priorActionStep } from "@/lib/workflows";
import { resolvePoolAgent, getLastStepAgent, recordStepAgent } from "@/lib/agent-pool";
import {
  agentDisplayName,
  buildAgentImportOptions,
  normalizeAgentIdentity,
  providerLabel,
} from "@/lib/agent-identity";

const CONFIG_DIR = join(homedir(), ".config", "foolery");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.toml");
const CACHE_TTL_MS = 30_000;
const KEYCHAIN_SENTINEL = "**keychain**";
const DEFAULT_SETTINGS: FoolerySettings = foolerySettingsSchema.parse({});
const CODEX_CONFIG_FILE = join(homedir(), ".codex", "config.toml");
const CLAUDE_SETTINGS_FILE = join(homedir(), ".claude", "settings.json");
const GEMINI_SETTINGS_FILE = join(homedir(), ".gemini", "settings.json");
const GEMINI_TMP_ROOT = join(homedir(), ".gemini", "tmp");

let cached: { value: FoolerySettings; loadedAt: number } | null = null;

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
    return { parsed: parse(raw), fileMissing: false };
  } catch (error) {
    return { parsed: {}, fileMissing: false, error: formatError(error) };
  }
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

/** Resolve keychain sentinel in loaded settings. */
async function resolveKeychainSecrets(
  settings: FoolerySettings,
): Promise<FoolerySettings> {
  if (settings.openrouter.apiKey !== KEYCHAIN_SENTINEL) {
    return settings;
  }
  const key = await keychainGet();
  return {
    ...settings,
    openrouter: { ...settings.openrouter, apiKey: key ?? "" },
  };
}

/**
 * Load settings from ~/.config/foolery/settings.toml.
 * Returns validated settings with defaults filled in.
 * Uses a 30-second TTL cache to avoid redundant disk reads.
 * Resolves keychain sentinel values for secrets.
 */
export async function loadSettings(): Promise<FoolerySettings> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const result = await computeSettingsDefaultsStatus();
  const resolved = await resolveKeychainSecrets(result.settings);
  cached = { value: resolved, loadedAt: Date.now() };
  return resolved;
}

/**
 * Write the full settings object to disk as TOML.
 * Creates the config directory if it doesn't exist.
 * When the OS keychain is available, the API key is stored there
 * and a sentinel value is written to the TOML file instead.
 */
export async function saveSettings(
  settings: FoolerySettings,
): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });

  // Attempt to store API key in OS keychain
  let settingsForDisk = settings;
  const apiKey = settings.openrouter.apiKey;
  if (!apiKey) {
    await keychainDelete();
  } else if (apiKey !== KEYCHAIN_SENTINEL) {
    const stored = await keychainSet(apiKey);
    if (stored) {
      settingsForDisk = {
        ...settings,
        openrouter: { ...settings.openrouter, apiKey: KEYCHAIN_SENTINEL },
      };
    }
  }

  const toml = stringify(settingsForDisk);
  await writeFile(SETTINGS_FILE, toml, "utf-8");
  await chmod(SETTINGS_FILE, 0o600);
  // Cache the full settings (with real key, not sentinel)
  cached = { value: settings, loadedAt: Date.now() };
}

/** Partial shape accepted by updateSettings for deep merging. */
export type SettingsPartial = Partial<{
  agents: FoolerySettings["agents"];
  actions: Partial<FoolerySettings["actions"]>;
  backend: Partial<FoolerySettings["backend"]>;
  defaults: Partial<FoolerySettings["defaults"]>;
  openrouter: Partial<FoolerySettings["openrouter"]>;
  pools: Partial<FoolerySettings["pools"]>;
  dispatchMode: FoolerySettings["dispatchMode"];
}>;

/**
 * Merge a partial update into the current settings, save, and return the result.
 * Each top-level section is only touched when explicitly provided in `partial`,
 * so sending `{ openrouter: { enabled: true } }` will never clobber agent/action config.
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
    openrouter:   partial.openrouter   !== undefined ? { ...current.openrouter,   ...partial.openrouter }   : current.openrouter,
    pools:        partial.pools        !== undefined ? { ...current.pools,        ...partial.pools }        : current.pools,
    dispatchMode: partial.dispatchMode !== undefined ? partial.dispatchMode                                 : current.dispatchMode,
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

/** Command used for OpenRouter virtual agents (the openrouter-agent CLI shim). */
const OPENROUTER_AGENT_COMMAND = "openrouter-agent";

function resolveSelectedOpenRouterAgentConfig(
  settings: FoolerySettings,
): RegisteredAgentConfig | null {
  const selectedModel = getSelectedOpenRouterModel(settings.openrouter);
  if (!selectedModel) return null;
  return {
    command: OPENROUTER_AGENT_COMMAND,
    model: selectedModel,
    label: formatOpenRouterSelectedAgentLabel(selectedModel),
  };
}

function toCliTarget(
  agent: RegisteredAgentConfig | RegisteredAgent,
  agentId?: string,
): CliAgentTarget {
  const normalized = normalizeAgentIdentity(agent);
  return {
    kind: "cli",
    command: agent.command,
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.version ? { version: normalized.version } : {}),
    ...((agent.label ?? agentDisplayName(agent))
      ? { label: agent.label ?? agentDisplayName(agent) }
      : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function toOpenRouterTarget(
  agent: RegisteredAgentConfig,
  agentId?: string,
): OpenRouterAgentTarget {
  return {
    kind: "openrouter",
    provider: "openrouter",
    authSource: "settings",
    model: agent.model ?? "",
    command: agent.command,
    ...(agent.version ? { version: agent.version } : {}),
    ...(agent.label ? { label: agent.label } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

/**
 * Returns virtual agents for all entries in openrouter.agents.
 * Each entry maps to an agent keyed by "openrouter:<agentKey>".
 * Only returns agents when OpenRouter is enabled and has agents configured.
 */
export function resolveOpenRouterAgents(
  settings: FoolerySettings,
): Record<string, RegisteredAgentConfig> {
  if (!settings.openrouter.enabled) return {};
  const result: Record<string, RegisteredAgentConfig> = {};
  for (const key of listUniqueOpenRouterAgentKeys(settings.openrouter.agents)) {
    const entry = settings.openrouter.agents[key];
    if (!entry) continue;
    const id = openrouterAgentId(key);
    result[id] = {
      command: OPENROUTER_AGENT_COMMAND,
      model: entry.model,
      label: formatOpenRouterAgentLabel(key, entry.label, entry.model),
    };
  }
  return result;
}

/**
 * Resolve a single OpenRouter virtual agent by its full ID (e.g. "openrouter:default").
 * Returns null if OpenRouter is not enabled or the agent key is not found.
 */
function resolveOpenRouterAgentById(
  settings: FoolerySettings,
  agentId: string,
): RegisteredAgentConfig | null {
  if (!isOpenRouterAgentId(agentId)) return null;
  if (!settings.openrouter.enabled) return null;
  const key = openrouterAgentKey(agentId);
  const entry = settings.openrouter.agents[key];
  if (!entry?.model?.trim()) return null;
  return {
    command: OPENROUTER_AGENT_COMMAND,
    model: entry.model,
    label: formatOpenRouterAgentLabel(key, entry.label, entry.model),
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
          ...(normalized.model ? { model: normalized.model } : {}),
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
  if (agentId === OPENROUTER_SELECTED_AGENT_ID) {
    const selected = resolveSelectedOpenRouterAgentConfig(settings);
    if (selected) {
      return toOpenRouterTarget(selected, agentId);
    }
  }
  if (isOpenRouterAgentId(agentId)) {
    const orAgent = resolveOpenRouterAgentById(settings, agentId);
    if (orAgent) {
      return toOpenRouterTarget(orAgent, agentId);
    }
  }
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
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
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

const SCANNABLE_AGENTS: readonly ScannableAgent[] = [
  { id: "claude", command: "claude" },
  { id: "codex", command: "codex" },
  { id: "gemini", command: "gemini" },
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
): Promise<Pick<ScannedAgent, "provider" | "model" | "version">> {
  const provider = providerLabel(undefined, resolvedCommand);
  if (agent.id === "codex") {
    const model = await readCodexConfiguredModel();
    const normalized = normalizeAgentIdentity({
      command: resolvedCommand,
      provider,
      model,
    });
    return {
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
    };
  }
  if (agent.id === "claude") {
    const model = await readClaudeConfiguredModel();
    const normalized = normalizeAgentIdentity({
      command: resolvedCommand,
      provider,
      model,
    });
    return {
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
    };
  }
  if (agent.id === "gemini") {
    const model = await readGeminiConfiguredModel();
    const normalized = normalizeAgentIdentity({
      command: resolvedCommand,
      provider,
      model,
    });
    return {
      ...(normalized.provider ? { provider: normalized.provider } : {}),
      ...(normalized.model ? { model: normalized.model } : {}),
      ...(normalized.version ? { version: normalized.version } : {}),
    };
  }
  const normalized = normalizeAgentIdentity({
    command: resolvedCommand,
    provider,
  });
  return {
    ...(normalized.provider ? { provider: normalized.provider } : {}),
    ...(normalized.model ? { model: normalized.model } : {}),
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
        return {
          id: agent.id,
          command: installed.command,
          path: installed.path,
          installed: true,
          ...metadata,
          options: buildAgentImportOptions(agent.id, metadata),
          selectedOptionId: buildAgentImportOptions(agent.id, metadata)[0]?.id,
        };
      }
      return {
        id: agent.id,
        command: agent.command,
        path: "",
        installed: false,
        ...(providerLabel(undefined, agent.command)
          ? { provider: providerLabel(undefined, agent.command) }
          : {}),
        options: buildAgentImportOptions(agent.id, {
          provider: providerLabel(undefined, agent.command),
        }),
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

  // Only use pools when dispatch mode is "pools"
  if (settings.dispatchMode === "pools") {
    const poolAgents: Record<string, RegisteredAgentConfig> = {
      ...settings.agents,
      ...resolveOpenRouterAgents(settings),
    };
    // Legacy: single selected OpenRouter model
    const selected = resolveSelectedOpenRouterAgentConfig(settings);
    if (selected) {
      poolAgents[OPENROUTER_SELECTED_AGENT_ID] = selected;
    }

    // Derive exclusion for cross-agent review
    let excludeAgentId: string | undefined;
    if (beatId && isReviewStep(step)) {
      const actionStep = priorActionStep(step);
      if (actionStep) {
        excludeAgentId = getLastStepAgent(beatId, actionStep);
      }
    }

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
      return poolAgent;
    }
  }

  // Fall back to action mapping
  if (fallbackAction) {
    const agentId = settings.actions[fallbackAction] ?? "";
    if (agentId === OPENROUTER_SELECTED_AGENT_ID) {
      const selected = resolveSelectedOpenRouterAgentConfig(settings);
      if (selected) {
        return toOpenRouterTarget(selected, agentId);
      }
    }
    if (isOpenRouterAgentId(agentId)) {
      const orAgent = resolveOpenRouterAgentById(settings, agentId);
      if (orAgent) {
        return toOpenRouterTarget(orAgent, agentId);
      }
    }
    if (agentId && agentId !== "default" && settings.agents[agentId]) {
      return toCliTarget(settings.agents[agentId], agentId);
    }
  }

  // Fall back to dispatch default
  return toCliTarget({ command: getFallbackCommand(settings) });
}

/** Returns the OpenRouter settings. */
export async function getOpenRouterSettings(): Promise<OpenRouterSettings> {
  const settings = await loadSettings();
  return settings.openrouter;
}

/** Reset the in-memory cache (useful for testing). */
export function _resetCache(): void {
  cached = null;
}
