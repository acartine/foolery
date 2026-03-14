import { execFile } from "node:child_process";
import { getBackend } from "./backend-instance";
import {
  getRegisteredAgents,
  loadSettings,
  updateSettings,
  inspectSettingsDefaults,
  inspectStaleSettingsKeys,
  backfillMissingSettingsDefaults,
  inspectSettingsPermissions,
  ensureSettingsPermissions,
  cleanStaleSettingsKeys,
} from "./settings";
import {
  listRepos,
  inspectMissingRepoMemoryManagerTypes,
  backfillMissingRepoMemoryManagerTypes,
  inspectRegistryPermissions,
  ensureRegistryPermissions,
  updateRegisteredRepoMemoryManagerType,
  type RegisteredRepo,
} from "./registry";
import { getReleaseVersionStatus, type ReleaseVersionStatus } from "./release-version";
import type { Beat, MemoryWorkflowDescriptor } from "./types";
import { detectMemoryManagerType } from "./memory-manager-detection";
import { isKnownMemoryManagerType } from "./memory-managers";


// ── Types ──────────────────────────────────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface FixOption {
  key: string;
  label: string;
}

export interface Diagnostic {
  check: string;
  severity: DiagnosticSeverity;
  message: string;
  fixable: boolean;
  /** Available fix strategies when fixable is true */
  fixOptions?: FixOption[];
  /** Context for auto-fix: which beat/repo/agent is affected */
  context?: Record<string, string>;
}

export interface FixResult {
  check: string;
  success: boolean;
  message: string;
  context?: Record<string, string>;
}

export interface DoctorReport {
  timestamp: string;
  diagnostics: Diagnostic[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    fixable: number;
  };
}

export interface DoctorFixReport {
  timestamp: string;
  fixes: FixResult[];
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

// ── Streaming types ─────────────────────────────────────

export type DoctorCheckStatus = "pass" | "fail" | "warning";

export interface DoctorCheckResult {
  done?: false;
  category: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
  diagnostics: Diagnostic[];
}

export interface DoctorStreamSummary {
  done: true;
  passed: number;
  failed: number;
  warned: number;
  fixable: number;
}

export type DoctorStreamEvent = DoctorCheckResult | DoctorStreamSummary;

async function listWorkflowsSafe(repoPath: string): Promise<MemoryWorkflowDescriptor[]> {
  try {
    const backend = getBackend() as {
      listWorkflows?: (repoPath?: string) => Promise<{
        ok: boolean;
        data?: MemoryWorkflowDescriptor[];
      }>;
    };
    if (typeof backend.listWorkflows !== "function") return [];
    const result = await backend.listWorkflows(repoPath);
    if (!result.ok) return [];
    return result.data ?? [];
  } catch {
    return [];
  }
}

// ── Agent health checks ────────────────────────────────────

async function pingAgent(command: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(command, ["--version"], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        const msg = error.message ?? String(error);
        resolve({ ok: false, error: msg.slice(0, 200) });
        return;
      }
      const trimmed = (stdout ?? "").trim();
      // Heuristic: a valid version response contains at least one digit
      if (!trimmed || !/\d/.test(trimmed)) {
        resolve({ ok: false, error: `Unexpected response: ${trimmed.slice(0, 120)}` });
        return;
      }
      resolve({ ok: true });
    });
  });
}

export async function checkAgents(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const agents = await getRegisteredAgents();

  const entries = Object.entries(agents);
  if (entries.length === 0) {
    diagnostics.push({
      check: "agents",
      severity: "warning",
      message: "No agents registered. Run `foolery setup` to configure agents.",
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
        message: `Agent "${r.id}" (${r.command}) is unreachable: ${r.error}`,
        fixable: false,
        context: { agentId: r.id, command: r.command },
      });
    } else {
      diagnostics.push({
        check: "agent-ping",
        severity: "info",
        message: `Agent "${r.id}" (${r.command}) is healthy.`,
        fixable: false,
        context: { agentId: r.id, command: r.command },
      });
    }
  }

  return diagnostics;
}

// ── Update check ───────────────────────────────────────────

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
      message: `Update available: ${status.latestVersion} (installed: ${status.installedVersion}). Run \`foolery update\`.`,
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

// ── Settings defaults checks ───────────────────────────────

const SETTINGS_DEFAULTS_FIX_OPTIONS: FixOption[] = [
  { key: "backfill", label: "Backfill missing settings defaults" },
];

const SETTINGS_STALE_KEYS_FIX_OPTIONS: FixOption[] = [
  { key: "clean", label: "Remove stale settings keys" },
];

const BACKEND_TYPE_MIGRATION_FIX_OPTIONS: FixOption[] = [
  { key: "migrate", label: "Migrate backend.type from cli to auto" },
];

const CONFIG_PERMISSIONS_FIX_OPTIONS: FixOption[] = [
  { key: "restrict", label: "Restrict config file permissions to 0600" },
];

const REPO_MEMORY_MANAGERS_FIX_OPTIONS: FixOption[] = [
  { key: "backfill", label: "Backfill missing repository memory manager metadata" },
];

const REGISTRY_CONSISTENCY_FIX_OPTIONS: FixOption[] = [
  { key: "sync", label: "Update registry to match detected type" },
];

function summarizeMissingSettings(paths: string[]): string {
  const preview = paths.slice(0, 4).join(", ");
  if (paths.length <= 4) return preview;
  return `${preview} (+${paths.length - 4} more)`;
}

function summarizePaths(paths: string[]): string {
  const preview = paths.slice(0, 3).join(", ");
  if (paths.length <= 3) return preview;
  return `${preview} (+${paths.length - 3} more)`;
}

function formatMode(mode: number): string {
  return `0${mode.toString(8).padStart(3, "0")}`;
}

function summarizeConfigPermissionIssues(
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

export async function checkSettingsDefaults(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const result = await inspectSettingsDefaults();

  if (result.error) {
    diagnostics.push({
      check: "settings-defaults",
      severity: "warning",
      message: `Could not inspect ~/.config/foolery/settings.toml: ${result.error}`,
      fixable: false,
    });
    return diagnostics;
  }

  const missingPaths = Array.from(new Set(result.missingPaths));
  if (result.fileMissing || missingPaths.length > 0) {
    const message = result.fileMissing
      ? "Settings file ~/.config/foolery/settings.toml is missing and should be created with defaults."
      : `Settings file ~/.config/foolery/settings.toml is missing default values: ${summarizeMissingSettings(missingPaths)}.`;
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
    message: "Settings defaults are present in ~/.config/foolery/settings.toml.",
    fixable: false,
  });
  return diagnostics;
}

export async function checkStaleSettingsKeys(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const result = await inspectStaleSettingsKeys();

  if (result.error) {
    diagnostics.push({
      check: "settings-stale-keys",
      severity: "warning",
      message: `Could not inspect ~/.config/foolery/settings.toml for stale keys: ${result.error}`,
      fixable: false,
    });
    return diagnostics;
  }

  const stalePaths = Array.from(new Set(result.stalePaths));
  if (stalePaths.length > 0) {
    diagnostics.push({
      check: "settings-stale-keys",
      severity: "warning",
      message: `Settings file ~/.config/foolery/settings.toml contains obsolete keys from v0.3.0: ${summarizeMissingSettings(stalePaths)}.`,
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
    message: "Settings file ~/.config/foolery/settings.toml does not contain known stale keys.",
    fixable: false,
  });
  return diagnostics;
}

// ── Backend type migration check ────────────────────────────────────

/**
 * Detect legacy backend.type = "cli" from v0.3.0 and offer migration to "auto".
 * The "auto" backend enables per-repo detection (knots vs beads).
 */
export async function checkBackendTypeMigration(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  try {
    const settings = await loadSettings();
    if (settings.backend.type === "cli") {
      diagnostics.push({
        check: "backend-type-migration",
        severity: "warning",
        message:
          'backend.type is set to "cli" (v0.3.0 default). Migrate to "auto" to enable per-repo backend detection.',
        fixable: true,
        fixOptions: BACKEND_TYPE_MIGRATION_FIX_OPTIONS,
        context: { currentType: "cli" },
      });
    } else {
      diagnostics.push({
        check: "backend-type-migration",
        severity: "info",
        message: `backend.type is "${settings.backend.type}".`,
        fixable: false,
      });
    }
  } catch (e) {
    diagnostics.push({
      check: "backend-type-migration",
      severity: "warning",
      message: `Could not check backend.type: ${e instanceof Error ? e.message : String(e)}`,
      fixable: false,
    });
  }

  return diagnostics;
}

export async function checkConfigPermissions(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const [settingsResult, registryResult] = await Promise.all([
    inspectSettingsPermissions(),
    inspectRegistryPermissions(),
  ]);

  const errors = [
    settingsResult.error
      ? `Could not inspect ~/.config/foolery/settings.toml permissions: ${settingsResult.error}`
      : null,
    registryResult.error
      ? `Could not inspect ~/.config/foolery/registry.json permissions: ${registryResult.error}`
      : null,
  ].filter((message): message is string => message !== null);

  if (errors.length > 0) {
    return errors.map((message) => ({
      check: "config-permissions",
      severity: "warning",
      message,
      fixable: false,
    }));
  }

  const issues: Array<{ path: string; actualMode?: number }> = [];
  if (!settingsResult.fileMissing && settingsResult.needsFix) {
    issues.push({
      path: "~/.config/foolery/settings.toml",
      actualMode: settingsResult.actualMode,
    });
  }
  if (!registryResult.fileMissing && registryResult.needsFix) {
    issues.push({
      path: "~/.config/foolery/registry.json",
      actualMode: registryResult.actualMode,
    });
  }

  if (issues.length > 0) {
    diagnostics.push({
      check: "config-permissions",
      severity: "warning",
      message: `Config files should be owner-only (0600): ${summarizeConfigPermissionIssues(issues)}.`,
      fixable: true,
      fixOptions: CONFIG_PERMISSIONS_FIX_OPTIONS,
      context: {
        files: issues.map((issue) => issue.path).join(","),
      },
    });
    return diagnostics;
  }

  diagnostics.push({
    check: "config-permissions",
    severity: "info",
    message: "Config file permissions are restricted to 0600 for existing config files.",
    fixable: false,
  });
  return diagnostics;
}

// ── Registry memory manager metadata checks ────────────────────────

export async function checkRepoMemoryManagerTypes(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const result = await inspectMissingRepoMemoryManagerTypes();

  if (result.error) {
    diagnostics.push({
      check: "repo-memory-managers",
      severity: "warning",
      message: `Could not inspect ~/.config/foolery/registry.json: ${result.error}`,
      fixable: false,
    });
    return diagnostics;
  }

  const missingRepoPaths = Array.from(new Set(result.missingRepoPaths));
  if (result.fileMissing) {
    diagnostics.push({
      check: "repo-memory-managers",
      severity: "info",
      message: "Repository registry ~/.config/foolery/registry.json does not exist yet.",
      fixable: false,
    });
    return diagnostics;
  }

  if (missingRepoPaths.length > 0) {
    diagnostics.push({
      check: "repo-memory-managers",
      severity: "warning",
      message: `Repository registry is missing memory manager metadata for ${missingRepoPaths.length} repo${missingRepoPaths.length === 1 ? "" : "s"}: ${summarizePaths(missingRepoPaths)}.`,
      fixable: true,
      fixOptions: REPO_MEMORY_MANAGERS_FIX_OPTIONS,
      context: {
        missingRepoPaths: missingRepoPaths.join(","),
      },
    });
    return diagnostics;
  }

  diagnostics.push({
    check: "repo-memory-managers",
    severity: "info",
    message: "Repository memory manager metadata is present in ~/.config/foolery/registry.json.",
    fixable: false,
  });
  return diagnostics;
}

export async function checkMemoryImplementationCompatibility(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    const detected = detectMemoryManagerType(repo.path);
    if (!detected) {
      diagnostics.push({
        check: "memory-implementation",
        severity: "error",
        fixable: false,
        message: `Repo "${repo.name}" is missing a compatible memory manager marker (.beads or .knots).`,
        context: { repoPath: repo.path, repoName: repo.name },
      });
      continue;
    }

    const workflows = await listWorkflowsSafe(repo.path);
    if (workflows.length === 0) {
      diagnostics.push({
        check: "memory-implementation",
        severity: "warning",
        fixable: false,
        message: `Repo "${repo.name}" could not enumerate workflows.`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          memoryManagerType: detected,
        },
      });
      continue;
    }

    const supportedModes = Array.from(new Set(workflows.map((workflow) => workflow.mode)));
    diagnostics.push({
      check: "memory-implementation",
      severity: "info",
      fixable: false,
      message: `Repo "${repo.name}" uses ${detected} with ${workflows.length} workflow${workflows.length === 1 ? "" : "s"} (${supportedModes.join(", ")}).`,
      context: {
        repoPath: repo.path,
        repoName: repo.name,
        memoryManagerType: detected,
        workflowIds: workflows.map((workflow) => workflow.id).join(","),
      },
    });
  }

  return diagnostics;
}

// ── Stale parent checks ────────────────────────────────────

const STALE_PARENT_FIX_OPTIONS: FixOption[] = [
  { key: "mark-in-progress", label: "Move to in_progress" },
];

/**
 * Finds parent beats (open or in_progress) where ALL children are closed.
 * These parents should likely be closed too.
 */
export async function checkStaleParents(repos: RegisteredRepo[]): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    let beats: Beat[];
    try {
      const result = await getBackend().list(undefined, repo.path);
      if (!result.ok || !result.data) continue;
      beats = result.data;
    } catch {
      continue;
    }

    const beatMap = new Map<string, Beat>();
    for (const b of beats) {
      beatMap.set(b.id, b);
    }

    // Group children by parent
    const childrenByParent = new Map<string, Beat[]>();
    for (const beat of beats) {
      if (beat.parent) {
        const existing = childrenByParent.get(beat.parent) ?? [];
        existing.push(beat);
        childrenByParent.set(beat.parent, existing);
      }
    }

    for (const [parentId, children] of Array.from(childrenByParent.entries())) {
      const parent = beatMap.get(parentId);
      if (!parent) continue;
      if (parent.state === "closed" || parent.state === "deferred") continue;

      const allChildrenClosed = children.length > 0 && children.every((c) => c.state === "closed");
      if (allChildrenClosed) {
        diagnostics.push({
          check: "stale-parent",
          severity: "warning",
          message: `Parent beat ${parent.id} ("${parent.title}") is "${parent.state}" but all ${children.length} children are closed in repo "${repo.name}".`,
          fixable: true,
          fixOptions: STALE_PARENT_FIX_OPTIONS,
          context: {
            beatId: parent.id,
            repoPath: repo.path,
            repoName: repo.name,
            currentState: parent.state,
            childCount: String(children.length),
          },
        });
      }
    }
  }

  return diagnostics;
}

// ── Memory manager CLI availability checks ─────────────────

const CLI_FOR_MEMORY_MANAGER: Record<string, { envVar: string; fallback: string }> = {
  knots: { envVar: "KNOTS_BIN", fallback: "kno" },
  beads: { envVar: "BD_BIN", fallback: "bd" },
};

export async function checkMemoryManagerCliAvailability(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const pingCache = new Map<string, { ok: boolean; error?: string }>();

  for (const repo of repos) {
    const mmType = repo.memoryManagerType;
    if (!mmType) continue;

    const cliInfo = CLI_FOR_MEMORY_MANAGER[mmType];
    if (!cliInfo) continue;

    const binary = process.env[cliInfo.envVar] || cliInfo.fallback;

    if (!pingCache.has(binary)) {
      pingCache.set(binary, await pingAgent(binary));
    }
    const result = pingCache.get(binary)!;

    if (!result.ok) {
      diagnostics.push({
        check: "memory-manager-cli",
        severity: "error",
        fixable: false,
        message: `Repo "${repo.name}" uses ${mmType} but CLI "${binary}" is unreachable: ${result.error}`,
        context: { repoPath: repo.path, repoName: repo.name, binary, memoryManagerType: mmType },
      });
    } else {
      diagnostics.push({
        check: "memory-manager-cli",
        severity: "info",
        fixable: false,
        message: `Repo "${repo.name}" uses ${mmType} and CLI "${binary}" is available.`,
        context: { repoPath: repo.path, repoName: repo.name, binary, memoryManagerType: mmType },
      });
    }
  }

  return diagnostics;
}

// ── Registry consistency checks ────────────────────────────

export async function checkRegistryConsistency(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    const registered = repo.memoryManagerType;
    const detected = detectMemoryManagerType(repo.path);

    if (detected === undefined) {
      // Repo directory may no longer exist or has no marker
      diagnostics.push({
        check: "registry-consistency",
        severity: "info",
        fixable: false,
        message: `Repo "${repo.name}" could not be detected on disk (registered as ${registered ?? "unset"}).`,
        context: { repoPath: repo.path, repoName: repo.name, registered: registered ?? "unset" },
      });
      continue;
    }

    if (registered !== detected) {
      diagnostics.push({
        check: "registry-consistency",
        severity: "warning",
        fixable: true,
        fixOptions: REGISTRY_CONSISTENCY_FIX_OPTIONS,
        message: `Repo "${repo.name}" is registered as "${registered ?? "unset"}" but detected as "${detected}".`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          registered: registered ?? "unset",
          detected,
        },
      });
    } else {
      diagnostics.push({
        check: "registry-consistency",
        severity: "info",
        fixable: false,
        message: `Repo "${repo.name}" registry type matches detected type (${detected}).`,
        context: { repoPath: repo.path, repoName: repo.name, detected },
      });
    }
  }

  return diagnostics;
}

// ── Run all checks ─────────────────────────────────────────

export async function runDoctor(): Promise<DoctorReport> {
  const repos = await listRepos();

  const [
    agentDiags,
    updateDiags,
    configPermissionDiags,
    settingsDiags,
    staleSettingsDiags,
    backendTypeDiags,
    repoMemoryManagerDiags,
    memoryCompatibilityDiags,
    staleDiags,
    cliAvailDiags,
    registryConsistencyDiags,
  ] = await Promise.all([
    checkAgents(),
    checkUpdates(),
    checkConfigPermissions(),
    checkSettingsDefaults(),
    checkStaleSettingsKeys(),
    checkBackendTypeMigration(),
    checkRepoMemoryManagerTypes(),
    checkMemoryImplementationCompatibility(repos),
    checkStaleParents(repos),
    checkMemoryManagerCliAvailability(repos),
    checkRegistryConsistency(repos),
  ]);

  const diagnostics = [
    ...agentDiags,
    ...updateDiags,
    ...configPermissionDiags,
    ...settingsDiags,
    ...staleSettingsDiags,
    ...backendTypeDiags,
    ...repoMemoryManagerDiags,
    ...memoryCompatibilityDiags,
    ...staleDiags,
    ...cliAvailDiags,
    ...registryConsistencyDiags,
  ];

  return {
    timestamp: new Date().toISOString(),
    diagnostics,
    summary: {
      errors: diagnostics.filter((d) => d.severity === "error").length,
      warnings: diagnostics.filter((d) => d.severity === "warning").length,
      infos: diagnostics.filter((d) => d.severity === "info").length,
      fixable: diagnostics.filter((d) => d.fixable).length,
    },
  };
}

// ── Streaming generator ─────────────────────────────────

function buildCategorySummary(diags: Diagnostic[]): { status: DoctorCheckStatus; summary: string } {
  const errors = diags.filter((d) => d.severity === "error");
  const warnings = diags.filter((d) => d.severity === "warning");

  if (errors.length > 0) {
    const count = errors.length;
    return { status: "fail", summary: `${count} issue${count !== 1 ? "s" : ""}` };
  }
  if (warnings.length > 0) {
    const count = warnings.length;
    return { status: "warning", summary: `${count} warning${count !== 1 ? "s" : ""}` };
  }

  // All info — derive a short "happy" summary from the first diagnostic
  if (diags.length > 0) {
    const first = diags[0];
    // Extract the interesting part from known messages
    if (first.check === "agent-ping") {
      const agents = diags.map((d) => d.context?.agentId).filter(Boolean);
      return { status: "pass", summary: `${agents.join(", ")} ${agents.length === 1 ? "is" : "are"} healthy` };
    }
    if (first.check === "updates" && first.message.includes("up to date")) {
      const versionMatch = first.message.match(/\(([^)]+)\)/);
      return { status: "pass", summary: `up to date${versionMatch ? ` (${versionMatch[1]})` : ""}` };
    }
  }

  return { status: "pass", summary: "no issues" };
}

export async function* streamDoctor(): AsyncGenerator<DoctorStreamEvent> {
  const repos = await listRepos();

  const checks: Array<{
    category: string;
    label: string;
    run: () => Promise<Diagnostic[]>;
  }> = [
    { category: "agents", label: "Agent connectivity", run: () => checkAgents() },
    { category: "updates", label: "Version", run: () => checkUpdates() },
    { category: "config-permissions", label: "Config permissions", run: () => checkConfigPermissions() },
    { category: "settings-defaults", label: "Settings defaults", run: () => checkSettingsDefaults() },
    { category: "settings-stale-keys", label: "Settings stale keys", run: () => checkStaleSettingsKeys() },
    { category: "backend-type-migration", label: "Backend type", run: () => checkBackendTypeMigration() },
    { category: "repo-memory-managers", label: "Repo memory managers", run: () => checkRepoMemoryManagerTypes() },
    { category: "memory-implementation", label: "Memory implementation", run: () => checkMemoryImplementationCompatibility(repos) },
    { category: "stale-parents", label: "Stale parents", run: () => checkStaleParents(repos) },
    { category: "memory-manager-cli", label: "Memory manager CLI", run: () => checkMemoryManagerCliAvailability(repos) },
    { category: "registry-consistency", label: "Registry consistency", run: () => checkRegistryConsistency(repos) },
  ];

  let passed = 0;
  let failed = 0;
  let warned = 0;
  let fixable = 0;

  for (const check of checks) {
    let diags: Diagnostic[];
    try {
      diags = await check.run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      diags = [{ check: check.category, severity: "error", message: msg, fixable: false }];
    }

    const { status, summary } = buildCategorySummary(diags);
    fixable += diags.filter((d) => d.fixable).length;

    if (status === "pass") passed++;
    else if (status === "fail") failed++;
    else warned++;

    yield { category: check.category, label: check.label, status, summary, diagnostics: diags };
  }

  yield { done: true, passed, failed, warned, fixable };
}

// ── Fix ────────────────────────────────────────────────────

/**
 * Strategies map: check name → fix option key (applies to all), or
 * an object with a strategy key and optional contexts array to target
 * specific diagnostics.
 *
 * Examples:
 *   { "stale-parent": { strategy: "mark-in-progress", contexts: [...] } } // fix specific
 *
 * If a check is absent from the map, its diagnostics are skipped.
 * If strategies is undefined, all fixable diagnostics use their first (default) option.
 */
export type FixStrategyEntry = string | { strategy: string; contexts?: Record<string, string>[] };
export type FixStrategies = Record<string, FixStrategyEntry>;

function matchesAnyContext(
  ctx: Record<string, string> | undefined,
  targets: Record<string, string>[],
): boolean {
  if (!ctx) return false;
  return targets.some((target) =>
    Object.entries(target).every(([k, v]) => ctx[k] === v),
  );
}

export async function runDoctorFix(strategies?: FixStrategies): Promise<DoctorFixReport> {
  const report = await runDoctor();
  const fixable = report.diagnostics.filter((d) => d.fixable);
  const fixes: FixResult[] = [];

  for (const diag of fixable) {
    // When strategies are provided, skip checks the user didn't approve
    if (strategies && !(diag.check in strategies)) continue;

    const entry = strategies?.[diag.check];
    let strategy: string | undefined;
    if (typeof entry === "string") {
      strategy = entry;
    } else if (entry) {
      strategy = entry.strategy;
      if (entry.contexts && !matchesAnyContext(diag.context, entry.contexts)) continue;
    }
    strategy ??= diag.fixOptions?.[0]?.key;

    const result = await applyFix(diag, strategy);
    fixes.push(result);
  }

  return {
    timestamp: new Date().toISOString(),
    fixes,
    summary: {
      attempted: fixes.length,
      succeeded: fixes.filter((f) => f.success).length,
      failed: fixes.filter((f) => !f.success).length,
    },
  };
}

async function applyFix(diag: Diagnostic, strategy?: string): Promise<FixResult> {
  const ctx = diag.context ?? {};

  switch (diag.check) {
    case "settings-defaults": {
      if (strategy && strategy !== "backfill" && strategy !== "default") {
        return {
          check: diag.check,
          success: false,
          message: `Unknown strategy "${strategy}" for settings defaults.`,
          context: ctx,
        };
      }
      try {
        const result = await backfillMissingSettingsDefaults();
        if (result.error) {
          return {
            check: diag.check,
            success: false,
            message: `Failed to backfill settings defaults: ${result.error}`,
            context: ctx,
          };
        }
        const count = result.missingPaths.length;
        if (!result.changed) {
          return {
            check: diag.check,
            success: true,
            message: "Settings defaults already present; no changes needed.",
            context: ctx,
          };
        }
        return {
          check: diag.check,
          success: true,
          message: `Backfilled ${count} missing setting${count === 1 ? "" : "s"} in ~/.config/foolery/settings.toml.`,
          context: {
            ...ctx,
            missingPaths: result.missingPaths.join(","),
          },
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "settings-stale-keys": {
      if (strategy && strategy !== "clean" && strategy !== "default") {
        return {
          check: diag.check,
          success: false,
          message: `Unknown strategy "${strategy}" for stale settings keys.`,
          context: ctx,
        };
      }
      try {
        const result = await cleanStaleSettingsKeys();
        if (result.error) {
          return {
            check: diag.check,
            success: false,
            message: `Failed to clean stale settings keys: ${result.error}`,
            context: ctx,
          };
        }
        const count = result.stalePaths.length;
        if (!result.changed) {
          return {
            check: diag.check,
            success: true,
            message: "No stale settings keys remain; no changes needed.",
            context: ctx,
          };
        }
        return {
          check: diag.check,
          success: true,
          message: `Removed ${count} stale setting key${count === 1 ? "" : "s"} from ~/.config/foolery/settings.toml.`,
          context: {
            ...ctx,
            stalePaths: result.stalePaths.join(","),
          },
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "config-permissions": {
      if (strategy && strategy !== "restrict" && strategy !== "default") {
        return {
          check: diag.check,
          success: false,
          message: `Unknown strategy "${strategy}" for config permissions.`,
          context: ctx,
        };
      }
      try {
        const [settingsResult, registryResult] = await Promise.all([
          ensureSettingsPermissions(),
          ensureRegistryPermissions(),
        ]);
        const errors = [
          settingsResult.error
            ? `settings.toml: ${settingsResult.error}`
            : null,
          registryResult.error
            ? `registry.json: ${registryResult.error}`
            : null,
        ].filter((message): message is string => message !== null);
        if (errors.length > 0) {
          return {
            check: diag.check,
            success: false,
            message: `Failed to restrict config file permissions: ${errors.join("; ")}`,
            context: ctx,
          };
        }
        const changedFiles = [
          settingsResult.changed ? "~/.config/foolery/settings.toml" : null,
          registryResult.changed ? "~/.config/foolery/registry.json" : null,
        ].filter((path): path is string => path !== null);
        if (changedFiles.length === 0) {
          return {
            check: diag.check,
            success: true,
            message: "Config file permissions already restricted; no changes needed.",
            context: ctx,
          };
        }
        return {
          check: diag.check,
          success: true,
          message: `Restricted config file permissions to 0600: ${changedFiles.join(", ")}.`,
          context: {
            ...ctx,
            files: changedFiles.join(","),
          },
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "repo-memory-managers": {
      if (strategy && strategy !== "backfill" && strategy !== "default") {
        return {
          check: diag.check,
          success: false,
          message: `Unknown strategy "${strategy}" for repo memory manager metadata.`,
          context: ctx,
        };
      }
      try {
        const result = await backfillMissingRepoMemoryManagerTypes();
        if (result.error) {
          return {
            check: diag.check,
            success: false,
            message: `Failed to backfill repository memory manager metadata: ${result.error}`,
            context: ctx,
          };
        }
        const count = result.migratedRepoPaths.length;
        if (!result.changed) {
          return {
            check: diag.check,
            success: true,
            message: "Repository memory manager metadata already present; no changes needed.",
            context: ctx,
          };
        }
        return {
          check: diag.check,
          success: true,
          message: `Backfilled memory manager metadata for ${count} repo${count === 1 ? "" : "s"} in ~/.config/foolery/registry.json.`,
          context: {
            ...ctx,
            migratedRepoPaths: result.migratedRepoPaths.join(","),
          },
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "stale-parent": {
      // Fix: move parent to in_progress (don't close — per project rules)
      const { beatId, repoPath } = ctx;
      if (!beatId || !repoPath) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      try {
        const result = await getBackend().update(
          beatId,
          { state: "in_progress" },
          repoPath,
        );
        if (!result.ok) {
          return { check: diag.check, success: false, message: result.error?.message ?? "bd update failed", context: ctx };
        }
        return {
          check: diag.check,
          success: true,
          message: `Moved ${beatId} to state=in_progress.`,
          context: ctx,
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "registry-consistency": {
      if (strategy && strategy !== "sync" && strategy !== "default") {
        return {
          check: diag.check,
          success: false,
          message: `Unknown strategy "${strategy}" for registry consistency.`,
          context: ctx,
        };
      }

      const { repoPath, detected } = ctx;
      if (!repoPath || !detected) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      if (!isKnownMemoryManagerType(detected)) {
        return {
          check: diag.check,
          success: false,
          message: `Detected memory manager type "${detected}" is not supported.`,
          context: ctx,
        };
      }

      try {
        const result = await updateRegisteredRepoMemoryManagerType(repoPath, detected);
        if (result.error) {
          return {
            check: diag.check,
            success: false,
            message: `Failed to update repository memory manager metadata: ${result.error}`,
            context: ctx,
          };
        }
        if (result.fileMissing) {
          return {
            check: diag.check,
            success: false,
            message: "Repository registry ~/.config/foolery/registry.json does not exist.",
            context: ctx,
          };
        }
        if (!result.repoFound) {
          return {
            check: diag.check,
            success: false,
            message: `Repository ${repoPath} is no longer registered.`,
            context: ctx,
          };
        }
        if (!result.changed) {
          return {
            check: diag.check,
            success: true,
            message: `Repository memory manager metadata already matches detected type "${detected}".`,
            context: ctx,
          };
        }
        return {
          check: diag.check,
          success: true,
          message: `Updated registry memory manager metadata for ${repoPath} to "${detected}".`,
          context: ctx,
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "backend-type-migration": {
      if (strategy && strategy !== "migrate" && strategy !== "default") {
        return {
          check: diag.check,
          success: false,
          message: `Unknown strategy "${strategy}" for backend type migration.`,
          context: ctx,
        };
      }
      try {
        await updateSettings({ backend: { type: "auto" } });
        return {
          check: diag.check,
          success: true,
          message: 'Migrated backend.type from "cli" to "auto" in ~/.config/foolery/settings.toml.',
          context: ctx,
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    default:
      return { check: diag.check, success: false, message: "No fix available for this check.", context: ctx };
  }
}
