import { stringify } from "smol-toml";
import { writeFile, mkdir, chmod } from "node:fs/promises";
import {
  foolerySettingsSchema,
  type FoolerySettings,
  type ScopeRefinementSettings,
  type RegisteredAgentConfig,
  type PoolsSettings,
} from "@/lib/schemas";
import type {
  RegisteredAgent,
  ActionName,
  AgentRemovalImpact,
  AgentRemovalRequest,
} from "@/lib/types";
import type { AgentTarget, CliAgentTarget } from "@/lib/types-agent-target";
import {
  type WorkflowStep,
  isReviewStep,
  priorActionStep,
} from "@/lib/workflows";
import {
  resolvePoolAgent,
  getLastStepAgent,
  recordStepAgent,
} from "@/lib/agent-pool";
import {
  formatAgentDisplayLabel,
  normalizeAgentIdentity,
} from "@/lib/agent-identity";
import {
  normalizeRegisteredAgentConfig,
  normalizeSettingsAgents,
} from "@/lib/agent-config-normalization";
import {
  applyAgentRemovalPlan,
  buildAgentRemovalImpact,
} from "@/lib/settings-agent-removal";
import {
  serverLog,
} from "@/lib/server-logger";
import {
  CONFIG_DIR,
  SETTINGS_FILE,
  CACHE_TTL_MS,
  DEFAULT_SETTINGS,
  getCache,
  setCache,
  formatError,
  mergeMissingDefaults,
  readRawSettings,
} from "@/lib/settings-core";

// ── Re-exports for API compatibility ─────────────────────────

export type {
  SettingsDefaultsAudit,
  SettingsDefaultsBackfillResult,
  SettingsPermissionsAudit,
  SettingsPermissionsFixResult,
  StaleSettingsAudit,
  StaleSettingsCleanupResult,
} from "@/lib/settings-maintenance";

export {
  inspectSettingsDefaults,
  inspectStaleSettingsKeys,
  backfillMissingSettingsDefaults,
  inspectSettingsPermissions,
  ensureSettingsPermissions,
  cleanStaleSettingsKeys,
} from "@/lib/settings-maintenance";

export { scanForAgents } from "@/lib/settings-agent-detect";

// ── Load / Save / Update ─────────────────────────────────────

/**
 * Load settings from ~/.config/foolery/settings.toml.
 * Returns validated settings with defaults filled in.
 * Uses a 30-second TTL cache to avoid redundant disk reads.
 */
export async function loadSettings(): Promise<FoolerySettings> {
  const cached = getCache();
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    serverLog("debug", "settings", "load cache hit", {
      settingsFile: SETTINGS_FILE,
    });
    return cached.value;
  }
  try {
    serverLog("debug", "settings", "load start", {
      settingsFile: SETTINGS_FILE,
    });
    const raw = await readRawSettings();
    if (raw.error) {
      serverLog("warn", "settings", "load read fallback", {
        settingsFile: SETTINGS_FILE,
        fileMissing: raw.fileMissing,
        error: raw.error,
      });
    }
    const { merged } = mergeMissingDefaults(
      raw.parsed,
      DEFAULT_SETTINGS as unknown as Record<
        string,
        unknown
      >,
    );
    const { normalized } =
      normalizeSettingsAgents(merged);
    let settings: FoolerySettings;
    try {
      settings = foolerySettingsSchema.parse(
        normalized,
      );
    } catch (error) {
      serverLog(
        "error",
        "settings",
        "load validation fallback",
        {
          settingsFile: SETTINGS_FILE,
          error: formatError(error),
        },
      );
      settings = DEFAULT_SETTINGS;
    }
    setCache(settings);
    serverLog("info", "settings", "load success", {
      settingsFile: SETTINGS_FILE,
      source: raw.fileMissing ? "defaults" : "disk",
      agentCount: Object.keys(settings.agents).length,
      dispatchMode: settings.dispatchMode,
    });
    return settings;
  } catch (error) {
    serverLog("error", "settings", "load failed", {
      settingsFile: SETTINGS_FILE,
      error: formatError(error),
    });
    throw error;
  }
}

/**
 * Write the full settings object to disk as TOML.
 * Creates the config directory if it doesn't exist.
 */
export async function saveSettings(
  settings: FoolerySettings,
): Promise<void> {
  try {
    serverLog("info", "settings", "save start", {
      settingsFile: SETTINGS_FILE,
      agentCount: Object.keys(settings.agents).length,
      dispatchMode: settings.dispatchMode,
    });
    await mkdir(CONFIG_DIR, { recursive: true });
    const normalized = foolerySettingsSchema.parse(
      normalizeSettingsAgents(settings).normalized,
    );
    const toml = stringify(normalized);
    await writeFile(SETTINGS_FILE, toml, "utf-8");
    await chmod(SETTINGS_FILE, 0o600);
    setCache(normalized);
    serverLog("info", "settings", "save success", {
      settingsFile: SETTINGS_FILE,
      agentCount: Object.keys(normalized.agents).length,
      dispatchMode: normalized.dispatchMode,
    });
  } catch (error) {
    serverLog("error", "settings", "save failed", {
      settingsFile: SETTINGS_FILE,
      error: formatError(error),
    });
    throw error;
  }
}

/** Partial shape accepted by updateSettings for deep merging. */
export type SettingsPartial = Partial<{
  agents: FoolerySettings["agents"];
  actions: Partial<FoolerySettings["actions"]>;
  backend: Partial<FoolerySettings["backend"]>;
  defaults: Partial<FoolerySettings["defaults"]>;
  scopeRefinement: Partial<FoolerySettings["scopeRefinement"]>;
  pools: Partial<FoolerySettings["pools"]>;
  dispatchMode: FoolerySettings["dispatchMode"];
  maxConcurrentSessions: FoolerySettings["maxConcurrentSessions"];
  maxClaimsPerQueueType: FoolerySettings["maxClaimsPerQueueType"];
  terminalLightTheme: FoolerySettings["terminalLightTheme"];
}>;

/**
 * Merge a partial update into the current settings, save,
 * and return the result. Each top-level section is only touched
 * when explicitly provided in `partial`.
 */
export async function updateSettings(
  partial: SettingsPartial,
): Promise<FoolerySettings> {
  try {
    serverLog("debug", "settings", "update start", {
      settingsFile: SETTINGS_FILE,
      keys: Object.keys(partial),
    });
    const current = await loadSettings();
    const merged = mergeSettingsPartial(
      current,
      partial,
    );
    const validated =
      foolerySettingsSchema.parse(merged);
    await saveSettings(validated);
    serverLog("info", "settings", "update success", {
      settingsFile: SETTINGS_FILE,
      keys: Object.keys(partial),
    });
    return validated;
  } catch (error) {
    serverLog("error", "settings", "update failed", {
      settingsFile: SETTINGS_FILE,
      keys: Object.keys(partial),
      error: formatError(error),
    });
    throw error;
  }
}

function mergeSettingsPartial(
  current: FoolerySettings,
  partial: SettingsPartial,
): FoolerySettings {
  return {
    ...current,
    agents: partial.agents !== undefined
      ? { ...current.agents, ...partial.agents }
      : current.agents,
    actions: partial.actions !== undefined
      ? { ...current.actions, ...partial.actions }
      : current.actions,
    backend: partial.backend !== undefined
      ? { ...current.backend, ...partial.backend }
      : current.backend,
    defaults: partial.defaults !== undefined
      ? { ...current.defaults, ...partial.defaults }
      : current.defaults,
    scopeRefinement: partial.scopeRefinement !== undefined
      ? { ...current.scopeRefinement, ...partial.scopeRefinement }
      : current.scopeRefinement,
    pools: partial.pools !== undefined
      ? { ...current.pools, ...partial.pools }
      : current.pools,
    dispatchMode: partial.dispatchMode !== undefined
      ? partial.dispatchMode
      : current.dispatchMode,
    maxConcurrentSessions:
      partial.maxConcurrentSessions !== undefined
        ? partial.maxConcurrentSessions
        : current.maxConcurrentSessions,
    maxClaimsPerQueueType:
      partial.maxClaimsPerQueueType !== undefined
        ? partial.maxClaimsPerQueueType
        : current.maxClaimsPerQueueType,
    terminalLightTheme:
      partial.terminalLightTheme !== undefined
        ? partial.terminalLightTheme
        : current.terminalLightTheme,
  };
}

// ── Agent target helpers ─────────────────────────────────────

/** Returns fallback command: first registered agent, or "claude". */
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
    ...(normalized.provider
      ? { provider: normalized.provider }
      : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(normalized.flavor ? { flavor: normalized.flavor } : {}),
    ...(normalized.version
      ? { version: normalized.version }
      : {}),
    ...((agent.label ?? formatAgentDisplayLabel(agent))
      ? {
        label:
          agent.label ??
          formatAgentDisplayLabel(agent),
      }
      : {}),
    ...(agentId ? { agentId } : {}),
  };
}

// ── Public dispatch API ──────────────────────────────────────

/** Returns the dispatch fallback command for unmapped actions. */
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
          ...(normalized.provider
            ? { provider: normalized.provider }
            : {}),
          ...(normalized.flavor
            ? { flavor: normalized.flavor }
            : {}),
          ...(normalized.version
            ? { version: normalized.version }
            : {}),
          ...(agent.label ? { label: agent.label } : {}),
        },
      ];
    }),
  );
}

/** Resolves an action name to its agent config. */
export async function getActionAgent(
  action: ActionName,
): Promise<AgentTarget> {
  const settings = await loadSettings();
  const agentId = settings.actions[action] ?? "";
  if (
    agentId &&
    agentId !== "default" &&
    settings.agents[agentId]
  ) {
    return toCliTarget(settings.agents[agentId], agentId);
  }
  return toCliTarget({ command: getFallbackCommand(settings) });
}

export async function getScopeRefinementSettings(): Promise<
  ScopeRefinementSettings
> {
  const settings = await loadSettings();
  return settings.scopeRefinement;
}

export async function getScopeRefinementAgent(
  excludeAgentIds?: ReadonlySet<string>,
): Promise<AgentTarget | null> {
  const settings = await loadSettings();

  if (settings.dispatchMode === "advanced") {
    const poolAgent = resolvePoolAgent(
      "scope_refinement",
      settings.pools,
      settings.agents,
      excludeAgentIds,
    );
    if (poolAgent) return poolAgent;
  }

  const agentId =
    settings.actions.scopeRefinement ?? "";
  if (
    agentId &&
    agentId !== "default" &&
    settings.agents[agentId]
    && !excludeAgentIds?.has(agentId)
  ) {
    return toCliTarget(
      settings.agents[agentId], agentId,
    );
  }

  return null;
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
    [id]: normalizeRegisteredAgentConfig(agent),
  };
  return updateSettings({ agents });
}

export async function getAgentRemovalImpact(
  id: string,
): Promise<AgentRemovalImpact> {
  const settings = await loadSettings();
  return buildAgentRemovalImpact(settings, id);
}

/** Removes a registered agent by id. */
export async function removeRegisteredAgent(
  request: string | AgentRemovalRequest,
): Promise<FoolerySettings> {
  const removalRequest = typeof request === "string"
    ? { id: request }
    : request;
  const current = await loadSettings();
  const impact = buildAgentRemovalImpact(
    current,
    removalRequest.id,
  );
  if (
    impact.actionUsages.length > 0
    || impact.poolUsages.length > 0
  ) {
    serverLog(
      "info",
      "settings",
      "remove agent with impact",
      {
        agentId: removalRequest.id,
        actionUsages: impact.actionUsages.map(
          (usage) => usage.action,
        ),
        poolUsages: impact.poolUsages.map(
          (usage) => usage.step,
        ),
      },
    );
  }
  const updated = applyAgentRemovalPlan(
    current,
    removalRequest,
  );
  const validated = foolerySettingsSchema.parse(
    updated,
  );
  await saveSettings(validated);
  return validated;
}

/** Returns the pools settings. */
export async function getPoolsSettings(): Promise<PoolsSettings> {
  const settings = await loadSettings();
  return settings.pools;
}

/**
 * Resolve an agent for a workflow step using pool config.
 * Falls back to the action's agent mapping if no pool is
 * configured, then to the dispatch fallback command.
 *
 * @param beatId - Beat ID for per-beat agent tracking.
 */
export async function getStepAgent(
  step: WorkflowStep,
  fallbackAction?: ActionName,
  beatId?: string,
): Promise<AgentTarget> {
  const settings = await loadSettings();

  if (settings.dispatchMode === "advanced") {
    const result = resolveStepFromPool(
      step,
      settings,
      beatId,
      fallbackAction,
    );
    if (result) return result;
  }

  if (fallbackAction) {
    const agentId = settings.actions[fallbackAction] ?? "";
    if (
      agentId &&
      agentId !== "default" &&
      settings.agents[agentId]
    ) {
      return toCliTarget(settings.agents[agentId], agentId);
    }
  }

  return toCliTarget({ command: getFallbackCommand(settings) });
}

function resolveStepFromPool(
  step: WorkflowStep,
  settings: FoolerySettings,
  beatId: string | undefined,
  fallbackAction: ActionName | undefined,
): AgentTarget | null {
  const poolAgents: Record<string, RegisteredAgentConfig> = {
    ...settings.agents,
  };

  let excludeAgentId: string | undefined;
  if (beatId && isReviewStep(step)) {
    const actionStep = priorActionStep(step);
    if (actionStep) {
      excludeAgentId = getLastStepAgent(beatId, actionStep);
    }
  }

  console.log(
    `[getStepAgent] step="${step}" ` +
      `dispatchMode="advanced" ` +
      `beatId=${beatId ?? "n/a"} ` +
      `fallbackAction=${fallbackAction ?? "n/a"} ` +
      `excludeAgentId=${excludeAgentId ?? "none"} ` +
      `registeredAgents=[${Object.keys(poolAgents).join(", ")}]`,
  );
  const poolAgent = resolvePoolAgent(
    step,
    settings.pools,
    poolAgents,
    excludeAgentId,
  );
  if (poolAgent) {
    if (beatId && poolAgent.agentId) {
      recordStepAgent(beatId, step, poolAgent.agentId);
    }
    console.log(
      `[getStepAgent] step="${step}" => pool selection: ` +
        `agentId=${poolAgent.agentId ?? "n/a"} ` +
        `kind=${poolAgent.kind} ` +
        `command=${poolAgent.command} ` +
        `model=${poolAgent.model ?? "n/a"}`,
    );
    return poolAgent;
  }
  console.log(
    `[getStepAgent] step="${step}" ` +
      `pool returned null, falling back to action mapping`,
  );
  return null;
}

/** Reset the in-memory cache (useful for testing). */
export function _resetCache(): void {
  setCache(null);
}
