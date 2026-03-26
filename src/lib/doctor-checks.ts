/**
 * Doctor diagnostic check functions.
 *
 * Extracted from doctor.ts to keep each module within
 * the 500-line file-length limit.
 */
import { execFile } from "node:child_process";
import {
  getRegisteredAgents,
  loadSettings,
  inspectSettingsDefaults,
  inspectStaleSettingsKeys,
} from "./settings";
import {
  listRepos,
  type RegisteredRepo,
} from "./registry";
import {
  getReleaseVersionStatus,
  type ReleaseVersionStatus,
} from "./release-version";
import type { Diagnostic, FixOption } from "./doctor-types";



// ── Agent health ping ───────────────────────────────────

export async function pingAgent(
  command: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      ["--version"],
      { timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          const msg = error.message ?? String(error);
          resolve({ ok: false, error: msg.slice(0, 200) });
          return;
        }
        const trimmed = (stdout ?? "").trim();
        if (!trimmed || !/\d/.test(trimmed)) {
          resolve({
            ok: false,
            error:
              `Unexpected response: ` +
              trimmed.slice(0, 120),
          });
          return;
        }
        resolve({ ok: true });
      },
    );
  });
}

// ── Fix option constants ────────────────────────────────

const SETTINGS_DEFAULTS_FIX_OPTIONS: FixOption[] = [
  {
    key: "backfill",
    label: "Backfill missing settings defaults",
  },
];

const SETTINGS_STALE_KEYS_FIX_OPTIONS: FixOption[] = [
  {
    key: "clean",
    label: "Remove stale settings keys",
  },
];

const BACKEND_TYPE_MIGRATION_FIX_OPTIONS: FixOption[] = [
  {
    key: "migrate",
    label: "Migrate backend.type from cli to auto",
  },
];

const CONFIG_PERMISSIONS_FIX_OPTIONS: FixOption[] = [
  {
    key: "restrict",
    label: "Restrict config file permissions to 0600",
  },
];

const REPO_MEMORY_MANAGERS_FIX_OPTIONS: FixOption[] = [
  {
    key: "backfill",
    label:
      "Backfill missing repository " +
      "memory manager metadata",
  },
];

const REGISTRY_CONSISTENCY_FIX_OPTIONS: FixOption[] = [
  {
    key: "sync",
    label: "Update registry to match detected type",
  },
];

const STALE_PARENT_FIX_OPTIONS: FixOption[] = [
  { key: "mark-in-progress", label: "Move to in_progress" },
];

const CLI_FOR_MEMORY_MANAGER: Record<
  string,
  { envVar: string; fallback: string }
> = {
  knots: { envVar: "KNOTS_BIN", fallback: "kno" },
  beads: { envVar: "BD_BIN", fallback: "bd" },
};

// ── Formatting helpers ──────────────────────────────────

function summarizeMissingSettings(
  paths: string[],
): string {
  const preview = paths.slice(0, 4).join(", ");
  if (paths.length <= 4) return preview;
  return `${preview} (+${paths.length - 4} more)`;
}

export function summarizePaths(paths: string[]): string {
  const preview = paths.slice(0, 3).join(", ");
  if (paths.length <= 3) return preview;
  return `${preview} (+${paths.length - 3} more)`;
}

export function formatMode(mode: number): string {
  return `0${mode.toString(8).padStart(3, "0")}`;
}

export function summarizeConfigPermissionIssues(
  issues: Array<{ path: string; actualMode?: number }>,
): string {
  return issues
    .map((issue) =>
      issue.actualMode === undefined
        ? issue.path
        : `${issue.path} (${formatMode(issue.actualMode)})`,
    )
    .join(", ");
}

// ── Check: agents ───────────────────────────────────────

export async function checkAgents(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const agents = await getRegisteredAgents();

  const entries = Object.entries(agents);
  if (entries.length === 0) {
    diagnostics.push({
      check: "agents",
      severity: "warning",
      message:
        "No agents registered." +
        " Run `foolery setup` to configure agents.",
      fixable: false,
    });
    return diagnostics;
  }

  const results = await Promise.all(
    entries.map(async ([id, config]) => {
      const result = await pingAgent(config.command);
      return { id, command: config.command, ...result };
    }),
  );

  for (const r of results) {
    if (!r.ok) {
      diagnostics.push({
        check: "agent-ping",
        severity: "error",
        message:
          `Agent "${r.id}" (${r.command})` +
          ` is unreachable: ${r.error}`,
        fixable: false,
        context: { agentId: r.id, command: r.command },
      });
    } else {
      diagnostics.push({
        check: "agent-ping",
        severity: "info",
        message:
          `Agent "${r.id}" (${r.command}) is healthy.`,
        fixable: false,
        context: { agentId: r.id, command: r.command },
      });
    }
  }

  return diagnostics;
}

// ── Check: updates ──────────────────────────────────────

export async function checkUpdates(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  let status: ReleaseVersionStatus;
  try {
    status = await getReleaseVersionStatus();
  } catch {
    diagnostics.push({
      check: "updates",
      severity: "warning",
      message: "Could not check for updates.",
      fixable: false,
    });
    return diagnostics;
  }

  if (status.updateAvailable) {
    diagnostics.push({
      check: "updates",
      severity: "warning",
      message:
        `Update available: ${status.latestVersion}` +
        ` (installed: ${status.installedVersion}).` +
        " Run `foolery update`.",
      fixable: false,
    });
  } else {
    const ver = status.installedVersion ?? "unknown";
    diagnostics.push({
      check: "updates",
      severity: "info",
      message: `Foolery is up to date (${ver}).`,
      fixable: false,
    });
  }

  return diagnostics;
}

// ── Check: settings defaults ────────────────────────────

export async function checkSettingsDefaults(): Promise<
  Diagnostic[]
> {
  const diagnostics: Diagnostic[] = [];
  const result = await inspectSettingsDefaults();

  if (result.error) {
    diagnostics.push({
      check: "settings-defaults",
      severity: "warning",
      message:
        "Could not inspect " +
        "~/.config/foolery/settings.toml: " +
        result.error,
      fixable: false,
    });
    return diagnostics;
  }

  const missingPaths = Array.from(
    new Set(result.missingPaths),
  );
  if (result.fileMissing || missingPaths.length > 0) {
    const message = result.fileMissing
      ? "Settings file " +
        "~/.config/foolery/settings.toml " +
        "is missing and should be created with defaults."
      : "Settings file " +
        "~/.config/foolery/settings.toml " +
        "is missing default values: " +
        `${summarizeMissingSettings(missingPaths)}.`;
    diagnostics.push({
      check: "settings-defaults",
      severity: "warning",
      message,
      fixable: true,
      fixOptions: SETTINGS_DEFAULTS_FIX_OPTIONS,
      context: {
        fileMissing: String(result.fileMissing),
        missingPaths: missingPaths.join(","),
      },
    });
    return diagnostics;
  }

  diagnostics.push({
    check: "settings-defaults",
    severity: "info",
    message:
      "Settings defaults are present in " +
      "~/.config/foolery/settings.toml.",
    fixable: false,
  });
  return diagnostics;
}

// ── Check: stale settings keys ──────────────────────────

export async function checkStaleSettingsKeys(): Promise<
  Diagnostic[]
> {
  const diagnostics: Diagnostic[] = [];
  const result = await inspectStaleSettingsKeys();

  if (result.error) {
    diagnostics.push({
      check: "settings-stale-keys",
      severity: "warning",
      message:
        "Could not inspect " +
        "~/.config/foolery/settings.toml " +
        `for stale keys: ${result.error}`,
      fixable: false,
    });
    return diagnostics;
  }

  const stalePaths = Array.from(
    new Set(result.stalePaths),
  );
  if (stalePaths.length > 0) {
    diagnostics.push({
      check: "settings-stale-keys",
      severity: "warning",
      message:
        "Settings file " +
        "~/.config/foolery/settings.toml " +
        "contains obsolete keys from v0.3.0: " +
        `${summarizeMissingSettings(stalePaths)}.`,
      fixable: true,
      fixOptions: SETTINGS_STALE_KEYS_FIX_OPTIONS,
      context: {
        stalePaths: stalePaths.join(","),
      },
    });
    return diagnostics;
  }

  diagnostics.push({
    check: "settings-stale-keys",
    severity: "info",
    message:
      "Settings file " +
      "~/.config/foolery/settings.toml " +
      "does not contain known stale keys.",
    fixable: false,
  });
  return diagnostics;
}

// ── Check: backend type migration ───────────────────────

export async function checkBackendTypeMigration(): Promise<
  Diagnostic[]
> {
  const diagnostics: Diagnostic[] = [];

  try {
    const settings = await loadSettings();
    if (settings.backend.type === "cli") {
      diagnostics.push({
        check: "backend-type-migration",
        severity: "warning",
        message:
          'backend.type is set to "cli" ' +
          "(v0.3.0 default). Migrate to " +
          '"auto" to enable per-repo ' +
          "backend detection.",
        fixable: true,
        fixOptions: BACKEND_TYPE_MIGRATION_FIX_OPTIONS,
        context: { currentType: "cli" },
      });
    } else {
      diagnostics.push({
        check: "backend-type-migration",
        severity: "info",
        message:
          `backend.type is ` +
          `"${settings.backend.type}".`,
        fixable: false,
      });
    }
  } catch (e) {
    diagnostics.push({
      check: "backend-type-migration",
      severity: "warning",
      message:
        `Could not check backend.type: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      fixable: false,
    });
  }

  return diagnostics;
}

export { listRepos, type RegisteredRepo };
export {
  STALE_PARENT_FIX_OPTIONS,
  CONFIG_PERMISSIONS_FIX_OPTIONS,
  REPO_MEMORY_MANAGERS_FIX_OPTIONS,
  REGISTRY_CONSISTENCY_FIX_OPTIONS,
  CLI_FOR_MEMORY_MANAGER,
};
