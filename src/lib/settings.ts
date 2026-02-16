import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  foolerySettingsSchema,
  type FoolerySettings,
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

/**
 * Merge a partial update into the current settings, save, and return the result.
 */
export async function updateSettings(
  partial: Partial<{
    agent: Partial<FoolerySettings["agent"]>;
    agents: FoolerySettings["agents"];
    actions: Partial<FoolerySettings["actions"]>;
  }>,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const merged: FoolerySettings = {
    ...current,
    agent: { ...current.agent, ...partial.agent },
    agents: partial.agents !== undefined ? partial.agents : current.agents,
    actions: { ...current.actions, ...partial.actions },
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
  Record<string, RegisteredAgent>
> {
  const settings = await loadSettings();
  return settings.agents;
}

/** Resolves an action name to its agent config. Falls back to default agent. */
export async function getActionAgent(
  action: ActionName,
): Promise<RegisteredAgent> {
  const settings = await loadSettings();
  const agentId = settings.actions[action] ?? "default";
  if (agentId !== "default" && settings.agents[agentId]) {
    return settings.agents[agentId];
  }
  return { command: settings.agent.command };
}

/** Adds or updates a registered agent. */
export async function addRegisteredAgent(
  id: string,
  agent: RegisteredAgent,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const agents = { ...current.agents, [id]: agent };
  return updateSettings({ agents });
}

/** Removes a registered agent by id. */
export async function removeRegisteredAgent(
  id: string,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const agents = { ...current.agents };
  delete agents[id];
  return updateSettings({ agents });
}

const SCANNABLE_AGENTS = ["claude", "codex", "gemini"] as const;

/** Scans PATH for known agent CLIs and returns what was found. */
export function scanForAgents(): ScannedAgent[] {
  return SCANNABLE_AGENTS.map((name) => {
    try {
      const path = execSync(`which ${name}`, { encoding: "utf-8" }).trim();
      return { id: name, command: name, path, installed: true };
    } catch {
      return { id: name, command: name, path: "", installed: false };
    }
  });
}

/** Reset the in-memory cache (useful for testing). */
export function _resetCache(): void {
  cached = null;
}
