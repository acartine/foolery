import { parse } from "smol-toml";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  foolerySettingsSchema,
  type FoolerySettings,
} from "@/lib/schemas";

export const CONFIG_DIR = join(homedir(), ".config", "foolery");
export const SETTINGS_FILE = join(CONFIG_DIR, "settings.toml");
export const CACHE_TTL_MS = 30_000;
export const DEFAULT_SETTINGS: FoolerySettings =
  foolerySettingsSchema.parse({});

const LEGACY_DISPATCH_MODE_MAP = {
  actions: "basic",
  pools: "advanced",
} as const;

let cached: {
  value: FoolerySettings;
  loadedAt: number;
} | null = null;

// ── Cache access ─────────────────────────────────────────────

export function getCache(): {
  value: FoolerySettings;
  loadedAt: number;
} | null {
  return cached;
}

export function setCache(
  settings: FoolerySettings | null,
): void {
  cached = settings
    ? { value: settings, loadedAt: Date.now() }
    : null;
}

// ── Utility helpers ──────────────────────────────────────────

export function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function collectLeafSettingPaths(
  value: unknown,
  path: string,
): string[] {
  if (!isRecord(value)) return [path];
  const entries = Object.entries(value);
  if (entries.length === 0) return [];
  return entries.flatMap(([key, nested]) =>
    collectLeafSettingPaths(nested, `${path}.${key}`),
  );
}

export function mergeMissingDefaults(
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
    const hasKey = Object.prototype.hasOwnProperty.call(
      source,
      key,
    );
    const currentValue = source[key];

    if (!hasKey || currentValue === undefined) {
      merged[key] = defaultValue;
      missingPaths.push(
        ...collectLeafSettingPaths(defaultValue, path),
      );
      continue;
    }

    if (isRecord(defaultValue) && isRecord(currentValue)) {
      const nested = mergeMissingDefaults(
        currentValue,
        defaultValue,
        path,
      );
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

// ── Legacy normalization ─────────────────────────────────────

function normalizeLegacyDispatchModeValue(
  value: unknown,
): unknown {
  if (typeof value !== "string") return value;
  return (
    LEGACY_DISPATCH_MODE_MAP[
      value as keyof typeof LEGACY_DISPATCH_MODE_MAP
    ] ?? value
  );
}

export function normalizeLegacySettings(
  current: unknown,
): Record<string, unknown> {
  const normalized = structuredClone(
    isRecord(current) ? current : {},
  ) as Record<string, unknown>;
  normalized.dispatchMode = normalizeLegacyDispatchModeValue(
    normalized.dispatchMode,
  );
  return normalized;
}

// ── Raw settings I/O ─────────────────────────────────────────

export async function readRawSettings(): Promise<{
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
    return {
      parsed: {},
      fileMissing: false,
      error: formatError(error),
    };
  }

  try {
    return {
      parsed: normalizeLegacySettings(parse(raw)),
      fileMissing: false,
    };
  } catch (error) {
    return {
      parsed: {},
      fileMissing: false,
      error: formatError(error),
    };
  }
}
