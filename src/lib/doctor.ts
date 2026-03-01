import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBackend } from "./backend-instance";
import {
  getRegisteredAgents,
  inspectSettingsDefaults,
  backfillMissingSettingsDefaults,
  loadSettings,
} from "./settings";
import {
  listRepos,
  inspectMissingRepoMemoryManagerTypes,
  backfillMissingRepoMemoryManagerTypes,
  type RegisteredRepo,
} from "./registry";
import { getReleaseVersionStatus, type ReleaseVersionStatus } from "./release-version";
import type { Beat, MemoryWorkflowDescriptor } from "./types";
import { detectMemoryManagerType } from "./memory-manager-detection";

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

const PROMPT_GUIDANCE_MARKER = "FOOLERY_GUIDANCE_PROMPT_START";
const PROMPT_PROFILE_MARKER = "FOOLERY_PROMPT_PROFILE:";
const PROMPT_PROFILE_REGEX = new RegExp(
  `${PROMPT_PROFILE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([A-Za-z0-9._-]+)`,
);

function promptProfileTemplateFor(_profileId: string, repoPath?: string): string {
  if (repoPath && detectMemoryManagerType(repoPath) === "knots") {
    return "PROMPT_KNOTS.md";
  }
  return "PROMPT_BEADS.md";
}

function fallbackPromptProfileForRepoPath(repoPath: string): string {
  void repoPath;
  return "autopilot";
}

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

const REPO_MEMORY_MANAGERS_FIX_OPTIONS: FixOption[] = [
  { key: "backfill", label: "Backfill missing repository memory manager metadata" },
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
      const fallbackProfile = fallbackPromptProfileForRepoPath(repo.path);
      diagnostics.push({
        check: "memory-implementation",
        severity: "warning",
        fixable: false,
        message: `Repo "${repo.name}" could not enumerate workflows; falling back to ${fallbackProfile}.`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          memoryManagerType: detected,
          fallbackProfile,
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

// ── Corrupt beat verification checks ──────────────────────

const CORRUPT_BEAT_FIX_OPTIONS: FixOption[] = [
  { key: "set-in-progress", label: "Set state to in_progress" },
  { key: "remove-label", label: "Remove stage:verification label" },
];

/**
 * Finds beats that have stage:verification label but state != in_progress.
 * These are inconsistent and should be fixed.
 */
export async function checkCorruptTickets(repos: RegisteredRepo[]): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    let beats: Beat[];
    try {
      const result = await getBackend().list(undefined, repo.path);
      if (!result.ok || !result.data) continue;
      beats = result.data;
    } catch {
      diagnostics.push({
        check: "corrupt-beats",
        severity: "warning",
        message: `Could not list beats for repo "${repo.name}" (${repo.path}).`,
        fixable: false,
        context: { repoPath: repo.path, repoName: repo.name },
      });
      continue;
    }

    for (const beat of beats) {
      const hasVerificationLabel = beat.labels.some((l) => l === "stage:verification");
      if (hasVerificationLabel && beat.state !== "in_progress") {
        diagnostics.push({
          check: "corrupt-beat-verification",
          severity: "error",
          message: `Beat ${beat.id} ("${beat.title}") has stage:verification label but state is "${beat.state}" (expected "in_progress") in repo "${repo.name}".`,
          fixable: true,
          fixOptions: CORRUPT_BEAT_FIX_OPTIONS,
          context: {
            beatId: beat.id,
            repoPath: repo.path,
            repoName: repo.name,
            currentState: beat.state,
          },
        });
      }
    }
  }

  return diagnostics;
}

// ── Stale parent checks ────────────────────────────────────

const STALE_PARENT_FIX_OPTIONS: FixOption[] = [
  { key: "mark-verification", label: "Move to in_progress with workflowState=verification" },
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const PROMPT_GUIDANCE_FIX_OPTIONS: FixOption[] = [
  { key: "append", label: "Append Foolery guidance prompt" },
];

const COARSE_PR_PREFERENCE_VALUES = new Set(["soft_required", "preferred", "none"]);

function parseOverrideKey(key: string): { repoPath: string; workflowId: string } | null {
  const separator = key.lastIndexOf("::");
  if (separator <= 0 || separator >= key.length - 2) return null;
  const repoPath = key.slice(0, separator).trim();
  const workflowId = key.slice(separator + 2).trim();
  if (!repoPath || !workflowId) return null;
  return { repoPath, workflowId };
}

export async function checkWorkflowPrPreferenceOverrides(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const settings = await loadSettings();
  const overrides = settings.workflow?.coarsePrPreferenceOverrides ?? {};
  const entries = Object.entries(overrides as Record<string, string>);

  if (entries.length === 0) {
    diagnostics.push({
      check: "workflow-pr-policy",
      severity: "info",
      fixable: false,
      message: "No coarse workflow PR preference overrides configured.",
    });
    return diagnostics;
  }

  const knownRepoPaths = new Set(repos.map((repo) => repo.path));
  const workflowIdsByRepo = new Map<string, Set<string>>();
  for (const repo of repos) {
    const workflows = await listWorkflowsSafe(repo.path);
    workflowIdsByRepo.set(repo.path, new Set(workflows.map((workflow) => workflow.id)));
  }

  for (const [key, value] of entries) {
    const parsedKey = parseOverrideKey(key);
    if (!parsedKey) {
      diagnostics.push({
        check: "workflow-pr-policy",
        severity: "warning",
        fixable: false,
        message: `Workflow PR override key "${key}" is invalid. Expected "<repoPath>::<workflowDescriptorId>".`,
        context: { key },
      });
      continue;
    }

    if (!COARSE_PR_PREFERENCE_VALUES.has(value)) {
      diagnostics.push({
        check: "workflow-pr-policy",
        severity: "warning",
        fixable: false,
        message: `Workflow PR override "${key}" has invalid value "${value}".`,
        context: { key, value },
      });
      continue;
    }

    if (!knownRepoPaths.has(parsedKey.repoPath)) {
      diagnostics.push({
        check: "workflow-pr-policy",
        severity: "warning",
        fixable: false,
        message: `Workflow PR override "${key}" references unknown repo "${parsedKey.repoPath}".`,
        context: { key, repoPath: parsedKey.repoPath, workflowId: parsedKey.workflowId },
      });
      continue;
    }

    const workflowIds = workflowIdsByRepo.get(parsedKey.repoPath) ?? new Set<string>();
    if (!workflowIds.has(parsedKey.workflowId)) {
      diagnostics.push({
        check: "workflow-pr-policy",
        severity: "warning",
        fixable: false,
        message: `Workflow PR override "${key}" references unknown workflow "${parsedKey.workflowId}" for repo "${parsedKey.repoPath}".`,
        context: { key, repoPath: parsedKey.repoPath, workflowId: parsedKey.workflowId },
      });
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      check: "workflow-pr-policy",
      severity: "info",
      fixable: false,
      message: `Workflow PR overrides are valid (${entries.length} configured).`,
    });
  }

  return diagnostics;
}

/**
 * Warn when AGENTS.md/CLAUDE.md exists but is missing Foolery guidance prompt.
 */
export async function checkPromptGuidance(repos: RegisteredRepo[]): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    const workflows = await listWorkflowsSafe(repo.path);
    const expectedProfiles = Array.from(
      new Set(workflows.map((workflow) => workflow.promptProfileId)),
    );
    const fallbackProfile = fallbackPromptProfileForRepoPath(repo.path);
    if (expectedProfiles.length === 0) expectedProfiles.push(fallbackProfile);

    for (const fileName of ["AGENTS.md", "CLAUDE.md"]) {
      const filePath = join(repo.path, fileName);
      if (!(await fileExists(filePath))) continue;

      try {
        const content = await readFile(filePath, "utf8");
        if (!content.includes(PROMPT_GUIDANCE_MARKER)) {
          diagnostics.push({
            check: "prompt-guidance",
            severity: "warning",
            fixable: true,
            fixOptions: PROMPT_GUIDANCE_FIX_OPTIONS,
            message: `Repo "${repo.name}" has ${fileName} but it is missing Foolery guidance prompt. Run \`foolery prompt\` in ${repo.path}.`,
            context: {
              repoPath: repo.path,
              repoName: repo.name,
              file: fileName,
              expectedProfiles: expectedProfiles.join(","),
              expectedProfile: expectedProfiles[0]!,
            },
          });
          continue;
        }

        const profileMatch = content.match(PROMPT_PROFILE_REGEX);
        const actualProfile = profileMatch?.[1];
        if (!actualProfile || !expectedProfiles.includes(actualProfile)) {
          diagnostics.push({
            check: "prompt-guidance",
            severity: "warning",
            fixable: true,
            fixOptions: PROMPT_GUIDANCE_FIX_OPTIONS,
            message: `Repo "${repo.name}" has ${fileName} with mismatched prompt profile${actualProfile ? ` (${actualProfile})` : ""}. Expected one of: ${expectedProfiles.join(", ")}.`,
            context: {
              repoPath: repo.path,
              repoName: repo.name,
              file: fileName,
              expectedProfiles: expectedProfiles.join(","),
              expectedProfile: expectedProfiles[0]!,
            },
          });
        }
      } catch {
        diagnostics.push({
          check: "prompt-guidance",
          severity: "warning",
          fixable: false,
          message: `Could not read ${fileName} in repo "${repo.name}" (${repo.path}).`,
          context: { repoPath: repo.path, repoName: repo.name, file: fileName },
        });
      }
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
    settingsDiags,
    repoMemoryManagerDiags,
    memoryCompatibilityDiags,
    workflowPrPolicyDiags,
    staleDiags,
    promptDiags,
  ] = await Promise.all([
    checkAgents(),
    checkUpdates(),
    checkSettingsDefaults(),
    checkRepoMemoryManagerTypes(),
    checkMemoryImplementationCompatibility(repos),
    checkWorkflowPrPreferenceOverrides(repos),
    checkStaleParents(repos),
    checkPromptGuidance(repos),
  ]);

  const diagnostics = [
    ...agentDiags,
    ...updateDiags,
    ...settingsDiags,
    ...repoMemoryManagerDiags,
    ...memoryCompatibilityDiags,
    ...workflowPrPolicyDiags,
    ...staleDiags,
    ...promptDiags,
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
    { category: "settings-defaults", label: "Settings defaults", run: () => checkSettingsDefaults() },
    { category: "repo-memory-managers", label: "Repo memory managers", run: () => checkRepoMemoryManagerTypes() },
    { category: "memory-implementation", label: "Memory implementation", run: () => checkMemoryImplementationCompatibility(repos) },
    { category: "workflow-pr-policy", label: "Workflow PR policy", run: () => checkWorkflowPrPreferenceOverrides(repos) },
    { category: "stale-parents", label: "Stale parents", run: () => checkStaleParents(repos) },
    { category: "prompt-guidance", label: "Prompt guidance", run: () => checkPromptGuidance(repos) },
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
 *   { "corrupt-beat-verification": "set-in-progress" }           // fix all
 *   { "prompt-guidance": { strategy: "append", contexts: [...] } } // fix specific
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

    case "corrupt-beat-verification": {
      const { beatId, repoPath } = ctx;
      if (!beatId || !repoPath) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      try {
        if (strategy === "remove-label") {
          // Fix: remove the stage:verification label to match the current state
          const result = await getBackend().update(beatId, { removeLabels: ["stage:verification"] }, repoPath);
          if (!result.ok) {
            return { check: diag.check, success: false, message: result.error?.message ?? "bd update failed", context: ctx };
          }
          return { check: diag.check, success: true, message: `Removed stage:verification from ${beatId}.`, context: ctx };
        }
        // Default: set state to in_progress to match the verification label
        const result = await getBackend().update(beatId, { state: "in_progress" }, repoPath);
        if (!result.ok) {
          return { check: diag.check, success: false, message: result.error?.message ?? "bd update failed", context: ctx };
        }
        return { check: diag.check, success: true, message: `Set ${beatId} state to in_progress.`, context: ctx };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "stale-parent": {
      // Fix: move parent into verification workflow state (don't close — per project rules)
      const { beatId, repoPath } = ctx;
      if (!beatId || !repoPath) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      try {
        const result = await getBackend().update(
          beatId,
          { state: "verification" },
          repoPath,
        );
        if (!result.ok) {
          return { check: diag.check, success: false, message: result.error?.message ?? "bd update failed", context: ctx };
        }
        return {
          check: diag.check,
          success: true,
          message: `Moved ${beatId} to state=verification.`,
          context: ctx,
        };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "prompt-guidance": {
      const { repoPath, file } = ctx;
      if (!repoPath || !file) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      try {
        const expectedProfile = ctx.expectedProfile;
        const templateCandidates = expectedProfile
          ? [promptProfileTemplateFor(expectedProfile, repoPath), "PROMPT.md"]
          : ["PROMPT.md"];
        const templateContent = await readPromptTemplate(templateCandidates);
        if (!templateContent) {
          return {
            check: diag.check,
            success: false,
            message: `Prompt template not found (${templateCandidates.join(", ")}).`,
            context: ctx,
          };
        }
        const filePath = join(repoPath, file);
        await appendFile(filePath, "\n\n" + templateContent + "\n", "utf8");
        return {
          check: diag.check,
          success: true,
          message: `Appended Foolery guidance to ${file} in "${ctx.repoName}".`,
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

async function readPromptTemplate(
  fileNames: string[] = ["PROMPT.md"],
): Promise<string | null> {
  const appDir = process.env.FOOLERY_APP_DIR;
  const candidates = fileNames.flatMap((fileName) => {
    const paths: string[] = [];
    try {
      paths.push(join(process.cwd(), fileName));
    } catch {
      // process.cwd() can throw in isolated temp directories during tests.
    }
    if (appDir) {
      paths.push(join(appDir, fileName));
    }
    return paths;
  });

  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}
