import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
} from "@/lib/schemas";
import type {
  RegisteredAgent,
  ActionName,
  ScannedAgent,
} from "@/lib/types";

const CONFIG_DIR = join(homedir(), ".config", "foolery");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.toml");
const CACHE_TTL_MS = 30_000;

let cached: { value: FoolerySettings; loadedAt: number } | null = null;

/**
 * Load settings from ~/.config/foolery/settings.toml.
 * Returns validated settings with defaults filled in.
 * Uses a 30-second TTL cache to avoid redundant disk reads.
 */
export async function loadSettings(): Promise<FoolerySettings> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    const parsed = parse(raw);
    const validated = foolerySettingsSchema.parse(parsed);
    cached = { value: validated, loadedAt: Date.now() };
    return validated;
  } catch {
    const defaults = foolerySettingsSchema.parse({});
    cached = { value: defaults, loadedAt: Date.now() };
    return defaults;
  }
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
  cached = { value: settings, loadedAt: Date.now() };
}

/** Partial shape accepted by updateSettings for deep merging. */
type SettingsPartial = Partial<{
  agent: Partial<FoolerySettings["agent"]>;
  agents: FoolerySettings["agents"];
  actions: Partial<FoolerySettings["actions"]>;
  verification: Partial<FoolerySettings["verification"]>;
}>;

/**
 * Merge a partial update into the current settings, save, and return the result.
 */
export async function updateSettings(
  partial: SettingsPartial,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const merged: FoolerySettings = {
    ...current,
    agent: { ...current.agent, ...partial.agent },
    agents: partial.agents !== undefined ? { ...current.agents, ...partial.agents } : current.agents,
    actions: { ...current.actions, ...partial.actions },
    verification: { ...current.verification, ...partial.verification },
  };
  const validated = foolerySettingsSchema.parse(merged);
  await saveSettings(validated);
  return validated;
}

/** Convenience helper: returns the configured agent command (default "claude"). */
export async function getAgentCommand(): Promise<string> {
  const settings = await loadSettings();
  return settings.agent.command;
}

/** Returns the registered agents map. */
export async function getRegisteredAgents(): Promise<
  Record<string, RegisteredAgentConfig>
> {
  const settings = await loadSettings();
  return settings.agents;
}

/** Resolves an action name to its agent config. Falls back to default agent. */
export async function getActionAgent(
  action: ActionName,
): Promise<RegisteredAgent> {
  const settings = await loadSettings();
  const agentId = settings.actions[action] ?? "";
  if (agentId && agentId !== "default" && settings.agents[agentId]) {
    const reg = settings.agents[agentId];
    return { command: reg.command, model: reg.model, label: reg.label };
  }
  return { command: settings.agent.command };
}

/** Returns the verification settings. */
export async function getVerificationSettings(): Promise<VerificationSettings> {
  const settings = await loadSettings();
  return settings.verification;
}

/** Resolves the verification agent config. Falls back to default agent. */
export async function getVerificationAgent(): Promise<RegisteredAgent> {
  const settings = await loadSettings();
  const agentId = settings.verification.agent ?? "";
  if (agentId && agentId !== "default" && settings.agents[agentId]) {
    const reg = settings.agents[agentId];
    return { command: reg.command, model: reg.model, label: reg.label };
  }
  return { command: settings.agent.command };
}

/** Adds or updates a registered agent. */
export async function addRegisteredAgent(
  id: string,
  agent: RegisteredAgent,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const agents = { ...current.agents, [id]: { command: agent.command, model: agent.model, label: agent.label } };
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

const SCANNABLE_AGENTS = ["claude", "codex", "gemini"] as const;

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

/** Reset the in-memory cache (useful for testing). */
export function _resetCache(): void {
  cached = null;
}
