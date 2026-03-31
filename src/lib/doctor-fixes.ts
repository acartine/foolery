/**
 * Per-check fix handlers for the doctor subsystem.
 *
 * Extracted from doctor.ts to keep each module within
 * the 500-line file-length limit.
 */
import { getBackend } from "./backend-instance";
import {
  updateSettings,
  backfillMissingSettingsDefaults,
  ensureSettingsPermissions,
  cleanStaleSettingsKeys,
} from "./settings";
import {
  backfillMissingRepoMemoryManagerTypes,
  ensureRegistryPermissions,
  updateRegisteredRepoMemoryManagerType,
} from "./registry";
import { isKnownMemoryManagerType } from "./memory-managers";
import type { Diagnostic, FixResult } from "./doctor-types";

// ── Per-check fix helpers ───────────────────────────────────

function unknownStrategy(
  check: string, strategy: string,
  label: string, ctx: Record<string, string>,
): FixResult {
  return {
    check, success: false, context: ctx,
    message:
      `Unknown strategy "${strategy}" for ${label}.`,
  };
}

function catchResult(
  check: string, e: unknown,
  ctx: Record<string, string>,
): FixResult {
  return {
    check, success: false,
    message: String(e), context: ctx,
  };
}

async function fixSettingsDefaults(
  ctx: Record<string, string>,
  check: string,
  strategy?: string,
): Promise<FixResult> {
  if (
    strategy &&
    strategy !== "backfill" &&
    strategy !== "default"
  ) {
    return unknownStrategy(
      check, strategy, "settings defaults", ctx,
    );
  }
  try {
    const result =
      await backfillMissingSettingsDefaults();
    if (result.error) {
      return {
        check,
        success: false,
        message:
          `Failed to backfill settings defaults: ` +
          result.error,
        context: ctx,
      };
    }
    const missingCount = result.missingPaths.length;
    const normalizationPaths =
      result.normalizationPaths ?? [];
    const normalizationCount =
      normalizationPaths.length;
    if (!result.changed) {
      return {
        check,
        success: true,
        message:
          "Settings defaults already present;" +
          " no changes needed.",
        context: ctx,
      };
    }
    return {
      check,
      success: true,
      message:
        [
          missingCount > 0
            ? `Backfilled ${missingCount} missing setting` +
              `${missingCount === 1 ? "" : "s"}`
            : null,
          normalizationCount > 0
            ? `normalized ${normalizationCount} persisted value` +
              `${normalizationCount === 1 ? "" : "s"}`
            : null,
        ].filter((part): part is string => part !== null).join(" and ") +
        " in ~/.config/foolery/settings.toml.",
      context: {
        ...ctx,
        missingPaths: result.missingPaths.join(","),
        normalizationPaths:
          normalizationPaths.join(","),
      },
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

async function fixStaleSettingsKeys(
  ctx: Record<string, string>,
  check: string,
  strategy?: string,
): Promise<FixResult> {
  if (
    strategy &&
    strategy !== "clean" &&
    strategy !== "default"
  ) {
    return unknownStrategy(
      check, strategy, "stale settings keys", ctx,
    );
  }
  try {
    const result = await cleanStaleSettingsKeys();
    if (result.error) {
      return {
        check,
        success: false,
        message:
          `Failed to clean stale settings keys: ` +
          result.error,
        context: ctx,
      };
    }
    const count = result.stalePaths.length;
    if (!result.changed) {
      return {
        check,
        success: true,
        message:
          "No stale settings keys remain;" +
          " no changes needed.",
        context: ctx,
      };
    }
    return {
      check,
      success: true,
      message:
        `Removed ${count} stale setting key` +
        `${count === 1 ? "" : "s"} from ` +
        `~/.config/foolery/settings.toml.`,
      context: {
        ...ctx,
        stalePaths: result.stalePaths.join(","),
      },
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

async function fixConfigPermissions(
  ctx: Record<string, string>,
  check: string,
  strategy?: string,
): Promise<FixResult> {
  if (
    strategy &&
    strategy !== "restrict" &&
    strategy !== "default"
  ) {
    return unknownStrategy(
      check, strategy, "config permissions", ctx,
    );
  }
  try {
    const [settingsResult, registryResult] =
      await Promise.all([
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
    ].filter(
      (msg): msg is string => msg !== null,
    );
    if (errors.length > 0) {
      return {
        check,
        success: false,
        message:
          `Failed to restrict config file permissions: ` +
          errors.join("; "),
        context: ctx,
      };
    }
    const changedFiles = [
      settingsResult.changed
        ? "~/.config/foolery/settings.toml"
        : null,
      registryResult.changed
        ? "~/.config/foolery/registry.json"
        : null,
    ].filter(
      (path): path is string => path !== null,
    );
    if (changedFiles.length === 0) {
      return {
        check,
        success: true,
        message:
          "Config file permissions already restricted;" +
          " no changes needed.",
        context: ctx,
      };
    }
    return {
      check,
      success: true,
      message:
        `Restricted config file permissions to 0600: ` +
        `${changedFiles.join(", ")}.`,
      context: {
        ...ctx,
        files: changedFiles.join(","),
      },
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

async function fixRepoMemoryManagers(
  ctx: Record<string, string>,
  check: string,
  strategy?: string,
): Promise<FixResult> {
  if (
    strategy &&
    strategy !== "backfill" &&
    strategy !== "default"
  ) {
    return unknownStrategy(
      check,
      strategy,
      "repo memory manager metadata",
      ctx,
    );
  }
  try {
    const result =
      await backfillMissingRepoMemoryManagerTypes();
    if (result.error) {
      return {
        check,
        success: false,
        message:
          `Failed to backfill repository ` +
          `memory manager metadata: ${result.error}`,
        context: ctx,
      };
    }
    const count = result.migratedRepoPaths.length;
    if (!result.changed) {
      return {
        check,
        success: true,
        message:
          "Repository memory manager metadata " +
          "already present; no changes needed.",
        context: ctx,
      };
    }
    return {
      check,
      success: true,
      message:
        `Backfilled memory manager metadata for ` +
        `${count} repo${count === 1 ? "" : "s"} in ` +
        `~/.config/foolery/registry.json.`,
      context: {
        ...ctx,
        migratedRepoPaths:
          result.migratedRepoPaths.join(","),
      },
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

async function fixStaleParent(
  ctx: Record<string, string>,
  check: string,
): Promise<FixResult> {
  const { beatId, repoPath } = ctx;
  if (!beatId || !repoPath) {
    return {
      check,
      success: false,
      message: "Missing context for fix.",
      context: ctx,
    };
  }
  try {
    const result = await getBackend().update(
      beatId,
      { state: "in_progress" },
      repoPath,
    );
    if (!result.ok) {
      return {
        check,
        success: false,
        message:
          result.error?.message ?? "bd update failed",
        context: ctx,
      };
    }
    return {
      check,
      success: true,
      message:
        `Moved ${beatId} to state=in_progress.`,
      context: ctx,
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

async function fixRegistryConsistency(
  ctx: Record<string, string>,
  check: string,
  strategy?: string,
): Promise<FixResult> {
  if (
    strategy &&
    strategy !== "sync" &&
    strategy !== "default"
  ) {
    return unknownStrategy(
      check,
      strategy,
      "registry consistency",
      ctx,
    );
  }

  const { repoPath, detected } = ctx;
  if (!repoPath || !detected) {
    return {
      check,
      success: false,
      message: "Missing context for fix.",
      context: ctx,
    };
  }
  if (!isKnownMemoryManagerType(detected)) {
    return {
      check,
      success: false,
      message:
        `Detected memory manager type ` +
        `"${detected}" is not supported.`,
      context: ctx,
    };
  }

  try {
    const result =
      await updateRegisteredRepoMemoryManagerType(
        repoPath, detected,
      );
    if (result.error) {
      return {
        check,
        success: false,
        message:
          `Failed to update repository ` +
          `memory manager metadata: ${result.error}`,
        context: ctx,
      };
    }
    if (result.fileMissing) {
      return {
        check,
        success: false,
        message:
          "Repository registry " +
          "~/.config/foolery/registry.json " +
          "does not exist.",
        context: ctx,
      };
    }
    if (!result.repoFound) {
      return {
        check,
        success: false,
        message:
          `Repository ${repoPath} ` +
          `is no longer registered.`,
        context: ctx,
      };
    }
    if (!result.changed) {
      return {
        check,
        success: true,
        message:
          `Repository memory manager metadata ` +
          `already matches detected ` +
          `type "${detected}".`,
        context: ctx,
      };
    }
    return {
      check,
      success: true,
      message:
        `Updated registry memory manager metadata ` +
        `for ${repoPath} to "${detected}".`,
      context: ctx,
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

async function fixBackendTypeMigration(
  ctx: Record<string, string>,
  check: string,
  strategy?: string,
): Promise<FixResult> {
  if (
    strategy &&
    strategy !== "migrate" &&
    strategy !== "default"
  ) {
    return unknownStrategy(
      check,
      strategy,
      "backend type migration",
      ctx,
    );
  }
  try {
    await updateSettings({ backend: { type: "auto" } });
    return {
      check,
      success: true,
      message:
        'Migrated backend.type from "cli" to "auto"' +
        " in ~/.config/foolery/settings.toml.",
      context: ctx,
    };
  } catch (e) {
    return catchResult(check, e, ctx);
  }
}

// ── Dispatcher ──────────────────────────────────────────────

export async function applyFix(
  diag: Diagnostic,
  strategy?: string,
): Promise<FixResult> {
  const ctx = diag.context ?? {};

  switch (diag.check) {
    case "settings-defaults":
      return fixSettingsDefaults(ctx, diag.check, strategy);
    case "settings-stale-keys":
      return fixStaleSettingsKeys(
        ctx, diag.check, strategy,
      );
    case "config-permissions":
      return fixConfigPermissions(
        ctx, diag.check, strategy,
      );
    case "repo-memory-managers":
      return fixRepoMemoryManagers(
        ctx, diag.check, strategy,
      );
    case "stale-parent":
      return fixStaleParent(ctx, diag.check);
    case "registry-consistency":
      return fixRegistryConsistency(
        ctx, diag.check, strategy,
      );
    case "backend-type-migration":
      return fixBackendTypeMigration(
        ctx, diag.check, strategy,
      );
    default:
      return {
        check: diag.check,
        success: false,
        message: "No fix available for this check.",
        context: ctx,
      };
  }
}
