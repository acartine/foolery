import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import { join } from "node:path";
import { homedir } from "node:os";
import {
  foolerySettingsSchema,
  type FoolerySettings,
  type RegisteredAgentConfig,
  type VerificationSettings,
  type OpenRouterSettings,
  type PoolsSettings,
} from "@/lib/schemas";
import { keychainSet, keychainGet, keychainDelete } from "@/lib/keychain";
import type {
  RegisteredAgent,
  ActionName,
  ScannedAgent,
} from "@/lib/types";
import { type WorkflowStep, isReviewStep, priorActionStep } from "@/lib/workflows";
import { resolvePoolAgent, getLastStepAgent, recordStepAgent } from "@/lib/agent-pool";

const CONFIG_DIR = join(homedir(), ".config", "foolery");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.toml");
const CACHE_TTL_MS = 30_000;
const KEYCHAIN_SENTINEL = "**keychain**";
const DEFAULT_SETTINGS: FoolerySettings = foolerySettingsSchema.parse({});

let cached: { value: FoolerySettings; loadedAt: number } | null = null;

interface SettingsDefaultsComputation {
  settings: FoolerySettings;
  merged: Record<string, unknown>;
  missingPaths: string[];
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
    return {
      settings,
      merged,
      missingPaths,
      fileMissing: raw.fileMissing,
    };
  } catch (error) {
    return {
      settings: DEFAULT_SETTINGS,
      merged: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      missingPaths: [],
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

  if (!result.error && (result.fileMissing || result.missingPaths.length > 0)) {
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
  verification: Partial<FoolerySettings["verification"]>;
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
    verification: partial.verification !== undefined ? { ...current.verification, ...partial.verification } : current.verification,
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
  return settings.agents;
}

/** Resolves an action name to its agent config. Falls back to dispatch default. */
export async function getActionAgent(
  action: ActionName,
): Promise<RegisteredAgent> {
  const settings = await loadSettings();
  const agentId = settings.actions[action] ?? "";
  if (agentId && agentId !== "default" && settings.agents[agentId]) {
    const reg = settings.agents[agentId];
    return {
      command: reg.command,
      ...(reg.model ? { model: reg.model } : {}),
      ...(reg.version ? { version: reg.version } : {}),
      ...(reg.label ? { label: reg.label } : {}),
    };
  }
  return { command: getFallbackCommand(settings) };
}

/** Returns the verification settings. */
export async function getVerificationSettings(): Promise<VerificationSettings> {
  const settings = await loadSettings();
  return settings.verification;
}

/** Resolves the verification agent config. Falls back to dispatch default. */
export async function getVerificationAgent(): Promise<RegisteredAgent> {
  const settings = await loadSettings();
  const agentId = settings.verification.agent ?? "";
  if (agentId && agentId !== "default" && settings.agents[agentId]) {
    const reg = settings.agents[agentId];
    return {
      command: reg.command,
      ...(reg.model ? { model: reg.model } : {}),
      ...(reg.version ? { version: reg.version } : {}),
      ...(reg.label ? { label: reg.label } : {}),
    };
  }
  return { command: getFallbackCommand(settings) };
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
  const agents = {
    ...current.agents,
    [id]: {
      command: agent.command,
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.version ? { version: agent.version } : {}),
      ...(agent.label ? { label: agent.label } : {}),
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

const SCANNABLE_AGENTS = ["claude", "codex", "gemini", "openrouter"] as const;

/** Scans PATH for known agent CLIs and returns what was found. */
export async function scanForAgents(): Promise<ScannedAgent[]> {
  const results = await Promise.all(
    SCANNABLE_AGENTS.map(async (name): Promise<ScannedAgent> => {
      try {
        const { stdout } = await execAsync(`which ${name}`);
        return { id: name, command: name, path: stdout.trim(), installed: true };
      } catch {
        return { id: name, command: name, path: "", installed: false };
      }
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
): Promise<RegisteredAgent> {
  const settings = await loadSettings();

  // Only use pools when dispatch mode is "pools"
  if (settings.dispatchMode === "pools") {
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
      settings.agents,
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
    if (agentId && agentId !== "default" && settings.agents[agentId]) {
      const reg = settings.agents[agentId];
      return {
        command: reg.command,
        ...(reg.model ? { model: reg.model } : {}),
        ...(reg.version ? { version: reg.version } : {}),
        ...(reg.label ? { label: reg.label } : {}),
      };
    }
  }

  // Fall back to dispatch default
  return { command: getFallbackCommand(settings) };
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
