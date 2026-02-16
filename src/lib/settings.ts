import { parse, stringify } from "smol-toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  foolerySettingsSchema,
  type FoolerySettings,
} from "@/lib/schemas";

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
  partial: Partial<{ agent: Partial<FoolerySettings["agent"]> }>,
): Promise<FoolerySettings> {
  const current = await loadSettings();
  const merged: FoolerySettings = {
    ...current,
    agent: { ...current.agent, ...partial.agent },
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

/** Reset the in-memory cache (useful for testing). */
export function _resetCache(): void {
  cached = null;
}
