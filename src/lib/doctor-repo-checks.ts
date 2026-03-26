/**
 * Repository-level doctor diagnostic checks.
 *
 * These checks operate on registered repos and are
 * extracted from doctor.ts to stay within file-length limits.
 */
import { getBackend } from "./backend-instance";
import { listLeases } from "./knots";
import { logLeaseAudit } from "./lease-audit";
import {
  inspectMissingRepoMemoryManagerTypes,
  inspectRegistryPermissions,
  type RegisteredRepo,
} from "./registry";
import {
  inspectSettingsPermissions,
} from "./settings";
import type {
  Beat,
  MemoryWorkflowDescriptor,
} from "./types";
import { detectMemoryManagerType } from "./memory-manager-detection";
import type { Diagnostic } from "./doctor-types";
import {
  pingAgent,
  summarizePaths,
  summarizeConfigPermissionIssues,
  STALE_PARENT_FIX_OPTIONS,
  CONFIG_PERMISSIONS_FIX_OPTIONS,
  REPO_MEMORY_MANAGERS_FIX_OPTIONS,
  REGISTRY_CONSISTENCY_FIX_OPTIONS,
  CLI_FOR_MEMORY_MANAGER,
} from "./doctor-checks";

async function listWorkflowsSafe(
  repoPath: string,
): Promise<MemoryWorkflowDescriptor[]> {
  try {
    const backend = getBackend() as {
      listWorkflows?: (
        repoPath?: string,
      ) => Promise<{
        ok: boolean;
        data?: MemoryWorkflowDescriptor[];
      }>;
    };
    if (typeof backend.listWorkflows !== "function") {
      return [];
    }
    const result = await backend.listWorkflows(repoPath);
    if (!result.ok) return [];
    return result.data ?? [];
  } catch {
    return [];
  }
}

// ── Check: config permissions ───────────────────────────

export async function checkConfigPermissions(): Promise<
  Diagnostic[]
> {
  const diagnostics: Diagnostic[] = [];
  const [settingsResult, registryResult] =
    await Promise.all([
      inspectSettingsPermissions(),
      inspectRegistryPermissions(),
    ]);

  const errors = [
    settingsResult.error
      ? "Could not inspect " +
        "~/.config/foolery/settings.toml " +
        `permissions: ${settingsResult.error}`
      : null,
    registryResult.error
      ? "Could not inspect " +
        "~/.config/foolery/registry.json " +
        `permissions: ${registryResult.error}`
      : null,
  ].filter(
    (message): message is string => message !== null,
  );

  if (errors.length > 0) {
    return errors.map((message) => ({
      check: "config-permissions", fixable: false,
      severity: "warning" as const, message,
    }));
  }

  const issues: Array<{
    path: string;
    actualMode?: number;
  }> = [];
  if (
    !settingsResult.fileMissing &&
    settingsResult.needsFix
  ) {
    issues.push({
      path: "~/.config/foolery/settings.toml",
      actualMode: settingsResult.actualMode,
    });
  }
  if (
    !registryResult.fileMissing &&
    registryResult.needsFix
  ) {
    issues.push({
      path: "~/.config/foolery/registry.json",
      actualMode: registryResult.actualMode,
    });
  }

  if (issues.length > 0) {
    diagnostics.push({
      check: "config-permissions",
      severity: "warning",
      message:
        "Config files should be owner-only (0600): " +
        `${summarizeConfigPermissionIssues(issues)}.`,
      fixable: true,
      fixOptions: CONFIG_PERMISSIONS_FIX_OPTIONS,
      context: {
        files: issues
          .map((issue) => issue.path)
          .join(","),
      },
    });
    return diagnostics;
  }

  diagnostics.push({
    check: "config-permissions",
    severity: "info",
    message:
      "Config file permissions are restricted to" +
      " 0600 for existing config files.",
    fixable: false,
  });
  return diagnostics;
}

// ── Check: repo memory manager types ────────────────────

export async function checkRepoMemoryManagerTypes(): Promise<
  Diagnostic[]
> {
  const diagnostics: Diagnostic[] = [];
  const result =
    await inspectMissingRepoMemoryManagerTypes();

  if (result.error) {
    diagnostics.push({
      check: "repo-memory-managers",
      severity: "warning",
      message:
        "Could not inspect " +
        "~/.config/foolery/registry.json: " +
        result.error,
      fixable: false,
    });
    return diagnostics;
  }

  const missingRepoPaths = Array.from(
    new Set(result.missingRepoPaths),
  );
  if (result.fileMissing) {
    diagnostics.push({
      check: "repo-memory-managers",
      severity: "info",
      message:
        "Repository registry " +
        "~/.config/foolery/registry.json " +
        "does not exist yet.",
      fixable: false,
    });
    return diagnostics;
  }

  if (missingRepoPaths.length > 0) {
    const count = missingRepoPaths.length;
    diagnostics.push({
      check: "repo-memory-managers",
      severity: "warning",
      message:
        "Repository registry is missing " +
        "memory manager metadata for " +
        `${count} repo${count === 1 ? "" : "s"}: ` +
        `${summarizePaths(missingRepoPaths)}.`,
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
    message:
      "Repository memory manager metadata is present" +
      " in ~/.config/foolery/registry.json.",
    fixable: false,
  });
  return diagnostics;
}

// ── Check: memory implementation compatibility ──────────

export async function checkMemoryImplementationCompatibility(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    const detected = detectMemoryManagerType(repo.path);
    if (!detected) {
      diagnostics.push({
        check: "memory-implementation", fixable: false,
        severity: "error",
        message:
          `Repo "${repo.name}" is missing a ` +
          "compatible memory manager marker " +
          "(.beads or .knots).",
        context: {
          repoPath: repo.path,
          repoName: repo.name,
        },
      });
      continue;
    }

    const workflows =
      await listWorkflowsSafe(repo.path);
    if (workflows.length === 0) {
      diagnostics.push({
        check: "memory-implementation", fixable: false,
        severity: "warning",
        message:
          `Repo "${repo.name}" could not ` +
          "enumerate workflows.",
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          memoryManagerType: detected,
        },
      });
      continue;
    }

    const modes = Array.from(
      new Set(workflows.map((w) => w.mode)),
    );
    const wfCount = workflows.length;
    diagnostics.push({
      check: "memory-implementation", fixable: false,
      severity: "info",
      message:
        `Repo "${repo.name}" uses ${detected} with ` +
        `${wfCount} workflow` +
        `${wfCount === 1 ? "" : "s"} ` +
        `(${modes.join(", ")}).`,
      context: {
        repoPath: repo.path,
        repoName: repo.name,
        memoryManagerType: detected,
        workflowIds: workflows
          .map((w) => w.id)
          .join(","),
      },
    });
  }

  return diagnostics;
}

// ── Check: stale parents ────────────────────────────────

export async function checkStaleParents(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    let beats: Beat[];
    try {
      const result = await getBackend().list(
        undefined, repo.path,
      );
      if (!result.ok || !result.data) continue;
      beats = result.data;
    } catch {
      continue;
    }

    const beatMap = new Map<string, Beat>();
    for (const b of beats) beatMap.set(b.id, b);

    const childrenByParent = new Map<string, Beat[]>();
    for (const beat of beats) {
      if (beat.parent) {
        const existing =
          childrenByParent.get(beat.parent) ?? [];
        existing.push(beat);
        childrenByParent.set(beat.parent, existing);
      }
    }

    for (const [parentId, children] of Array.from(
      childrenByParent.entries(),
    )) {
      const parent = beatMap.get(parentId);
      if (!parent) continue;
      if (
        parent.state === "closed" ||
        parent.state === "deferred"
      ) {
        continue;
      }

      const allClosed =
        children.length > 0 &&
        children.every((c) => c.state === "closed");
      if (allClosed) {
        diagnostics.push({
          check: "stale-parent",
          severity: "warning",
          message:
            `Parent beat ${parent.id} ` +
            `("${parent.title}") is ` +
            `"${parent.state}" but all ` +
            `${children.length} children are ` +
            `closed in repo "${repo.name}".`,
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

// ── Check: memory manager CLI availability ──────────────

export async function checkMemoryManagerCliAvailability(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const pingCache = new Map<
    string,
    { ok: boolean; error?: string }
  >();

  for (const repo of repos) {
    const mmType = repo.memoryManagerType;
    if (!mmType) continue;

    const cliInfo = CLI_FOR_MEMORY_MANAGER[mmType];
    if (!cliInfo) continue;

    const binary =
      process.env[cliInfo.envVar] || cliInfo.fallback;

    if (!pingCache.has(binary)) {
      pingCache.set(binary, await pingAgent(binary));
    }
    const result = pingCache.get(binary)!;

    if (!result.ok) {
      diagnostics.push({
        check: "memory-manager-cli", fixable: false,
        severity: "error",
        message:
          `Repo "${repo.name}" uses ${mmType} ` +
          `but CLI "${binary}" is unreachable: ` +
          result.error,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          binary,
          memoryManagerType: mmType,
        },
      });
    } else {
      diagnostics.push({
        check: "memory-manager-cli", fixable: false,
        severity: "info",
        message:
          `Repo "${repo.name}" uses ${mmType} ` +
          `and CLI "${binary}" is available.`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          binary,
          memoryManagerType: mmType,
        },
      });
    }
  }

  return diagnostics;
}

// ── Check: registry consistency ─────────────────────────

export async function checkRegistryConsistency(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    const registered = repo.memoryManagerType;
    const detected = detectMemoryManagerType(repo.path);

    if (detected === undefined) {
      diagnostics.push({
        check: "registry-consistency", fixable: false,
        severity: "info",
        message:
          `Repo "${repo.name}" could not be ` +
          "detected on disk (registered as " +
          `${registered ?? "unset"}).`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          registered: registered ?? "unset",
        },
      });
      continue;
    }

    if (registered !== detected) {
      diagnostics.push({
        check: "registry-consistency", fixable: true,
        severity: "warning",
        fixOptions: REGISTRY_CONSISTENCY_FIX_OPTIONS,
        message:
          `Repo "${repo.name}" is registered as ` +
          `"${registered ?? "unset"}" but ` +
          `detected as "${detected}".`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          registered: registered ?? "unset",
          detected,
        },
      });
    } else {
      diagnostics.push({
        check: "registry-consistency", fixable: false,
        severity: "info",
        message:
          `Repo "${repo.name}" registry type ` +
          `matches detected type (${detected}).`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          detected,
        },
      });
    }
  }

  return diagnostics;
}

// ── Check: active Knots leases ──────────────────────────

export async function checkActiveKnotsLeases(
  repos: RegisteredRepo[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    const mmType =
      repo.memoryManagerType ??
      detectMemoryManagerType(repo.path);
    if (mmType !== "knots") continue;

    const result = await listLeases(repo.path);
    if (!result.ok) {
      diagnostics.push({
        check: "active-knots-leases", fixable: false,
        severity: "warning",
        message:
          `Repo "${repo.name}" could not list ` +
          `active Knots leases: ${result.error}`,
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          memoryManagerType: mmType,
        },
      });
      continue;
    }

    const leases = result.data ?? [];
    if (leases.length === 0) {
      diagnostics.push({
        check: "active-knots-leases", fixable: false,
        severity: "info",
        message:
          `Repo "${repo.name}" has no ` +
          "active Knots leases.",
        context: {
          repoPath: repo.path,
          repoName: repo.name,
          memoryManagerType: mmType,
        },
      });
      continue;
    }

    logLeaseAudit({
      event: "orphan_leases_detected",
      repoPath: repo.path,
      interactionType: "doctor_active_leases",
      outcome: "warning",
      message:
        `Detected ${leases.length} active Knots ` +
        `lease(s) in repo "${repo.name}".`,
      data: {
        repoName: repo.name,
        leaseIds: leases.map((lease) => lease.id),
      },
    });

    const count = leases.length;
    const ids = leases
      .map((lease) => lease.id)
      .join(", ");
    diagnostics.push({
      check: "active-knots-leases",
      severity: "warning",
      fixable: false,
      message:
        `Repo "${repo.name}" has ${count} active ` +
        `Knots lease${count === 1 ? "" : "s"}: ${ids}.`,
      context: {
        repoPath: repo.path,
        repoName: repo.name,
        memoryManagerType: mmType,
        leaseIds: leases
          .map((lease) => lease.id)
          .join(","),
      },
    });
  }

  return diagnostics;
}
