import { writeFile, mkdir, chmod, stat } from "node:fs/promises";
import { stringify } from "smol-toml";
import {
  CONFIG_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
  readRawSettings,
  mergeMissingDefaults,
  isRecord,
  formatError,
  setCache,
} from "@/lib/settings-core";
import { foolerySettingsSchema, type FoolerySettings } from "@/lib/schemas";
import { isDeepStrictEqual } from "node:util";
import { normalizeSettingsAgents } from "@/lib/agent-config-normalization";

// ── Types ────────────────────────────────────────────────────

interface SettingsDefaultsComputation {
  settings: FoolerySettings;
  merged: Record<string, unknown>;
  missingPaths: string[];
  normalizationPaths: string[];
  normalizationChanged: boolean;
  fileMissing: boolean;
  error?: string;
}

export interface SettingsDefaultsAudit {
  settings: FoolerySettings;
  missingPaths: string[];
  normalizationPaths: string[];
  fileMissing: boolean;
  error?: string;
}

export interface SettingsDefaultsBackfillResult
  extends SettingsDefaultsAudit {
  changed: boolean;
}

export interface SettingsPermissionsAudit {
  fileMissing: boolean;
  needsFix: boolean;
  actualMode?: number;
  error?: string;
}

export interface SettingsPermissionsFixResult
  extends SettingsPermissionsAudit {
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

// ── Stale key removal ────────────────────────────────────────

const STALE_TOP_LEVEL_SETTINGS_KEYS = [
  "agent",
  "verification",
] as const;
const STALE_ACTION_SETTINGS_KEYS = ["direct"] as const;

function removeStaleSettingsKeys(current: unknown): {
  cleaned: Record<string, unknown>;
  stalePaths: string[];
} {
  const cleaned = structuredClone(
    isRecord(current) ? current : {},
  ) as Record<string, unknown>;
  const stalePaths: string[] = [];

  for (const key of STALE_TOP_LEVEL_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      delete cleaned[key];
      stalePaths.push(key);
    }
  }

  if (isRecord(cleaned.actions)) {
    for (const key of STALE_ACTION_SETTINGS_KEYS) {
      if (
        Object.prototype.hasOwnProperty.call(cleaned.actions, key)
      ) {
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

// ── Computation helpers ──────────────────────────────────────

function normalizeMode(mode: number): number {
  return mode & 0o777;
}

async function computeSettingsDefaultsStatus(): Promise<
  SettingsDefaultsComputation
> {
  const raw = await readRawSettings();
  if (raw.error) {
    return {
      settings: DEFAULT_SETTINGS,
      merged: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      missingPaths: [],
      normalizationPaths: [],
      normalizationChanged: false,
      fileMissing: raw.fileMissing,
      error: raw.error,
    };
  }

  const { merged, missingPaths } = mergeMissingDefaults(
    raw.parsed,
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
  );
  const normalizedResult = normalizeSettingsAgents(merged);

  try {
    const settings = foolerySettingsSchema.parse(
      normalizedResult.normalized,
    );
    const normalized = settings as unknown as Record<string, unknown>;
    return {
      settings,
      merged: normalized,
      missingPaths,
      normalizationPaths: normalizedResult.changedPaths,
      normalizationChanged:
        normalizedResult.changedPaths.length > 0 ||
        !isDeepStrictEqual(
          normalized,
          normalizedResult.normalized,
        ),
      fileMissing: raw.fileMissing,
    };
  } catch (error) {
    return {
      settings: DEFAULT_SETTINGS,
      merged: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      missingPaths: [],
      normalizationPaths: [],
      normalizationChanged: false,
      fileMissing: raw.fileMissing,
      error: formatError(error),
    };
  }
}

async function computeStaleSettingsStatus(): Promise<
  StaleSettingsComputation
> {
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
  return { cleaned, stalePaths, fileMissing: raw.fileMissing };
}

// ── Public API ───────────────────────────────────────────────

/** Inspect whether settings.toml is missing known defaults. */
export async function inspectSettingsDefaults(): Promise<
  SettingsDefaultsAudit
> {
  const result = await computeSettingsDefaultsStatus();
  return {
    settings: result.settings,
    missingPaths: result.missingPaths,
    normalizationPaths: result.normalizationPaths,
    fileMissing: result.fileMissing,
    error: result.error,
  };
}

/** Inspect whether settings.toml still has known stale keys. */
export async function inspectStaleSettingsKeys(): Promise<
  StaleSettingsAudit
> {
  const result = await computeStaleSettingsStatus();
  return {
    stalePaths: result.stalePaths,
    fileMissing: result.fileMissing,
    error: result.error,
  };
}

/**
 * Backfill missing defaults into settings.toml without
 * overwriting existing values.
 */
export async function backfillMissingSettingsDefaults(): Promise<
  SettingsDefaultsBackfillResult
> {
  const result = await computeSettingsDefaultsStatus();
  let changed = false;

  if (
    !result.error &&
    (result.fileMissing ||
      result.missingPaths.length > 0 ||
      result.normalizationChanged)
  ) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, stringify(result.merged), "utf-8");
    await chmod(SETTINGS_FILE, 0o600);
    changed = true;
  }

  setCache(result.settings);
  return {
    settings: result.settings,
    missingPaths: result.missingPaths,
    normalizationPaths: result.normalizationPaths,
    fileMissing: result.fileMissing,
    error: result.error,
    changed,
  };
}

export async function inspectSettingsPermissions(): Promise<
  SettingsPermissionsAudit
> {
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
      return { fileMissing: true, needsFix: false };
    }
    return {
      fileMissing: false,
      needsFix: false,
      error: formatError(error),
    };
  }
}

export async function ensureSettingsPermissions(): Promise<
  SettingsPermissionsFixResult
> {
  const result = await inspectSettingsPermissions();
  if (result.error || result.fileMissing || !result.needsFix) {
    return { ...result, changed: false };
  }

  await chmod(SETTINGS_FILE, 0o600);
  return {
    fileMissing: false,
    needsFix: false,
    actualMode: 0o600,
    changed: true,
  };
}

/** Remove obsolete settings keys no longer used by the app. */
export async function cleanStaleSettingsKeys(): Promise<
  StaleSettingsCleanupResult
> {
  const result = await computeStaleSettingsStatus();
  let changed = false;

  if (!result.error && result.stalePaths.length > 0) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(
      SETTINGS_FILE,
      stringify(result.cleaned),
      "utf-8",
    );
    await chmod(SETTINGS_FILE, 0o600);
    changed = true;
  }

  setCache(null);
  return {
    stalePaths: result.stalePaths,
    fileMissing: result.fileMissing,
    error: result.error,
    changed,
  };
}
