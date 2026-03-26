/**
 * Public facade for the doctor diagnostic subsystem.
 *
 * Implementation is split across:
 *   doctor-types.ts       — shared type definitions
 *   doctor-checks.ts      — settings/agent/update checks
 *   doctor-repo-checks.ts — per-repo checks
 *   doctor-fixes.ts       — applyFix dispatch + handlers
 */
import {
  checkAgents,
  checkUpdates,
  checkSettingsDefaults,
  checkStaleSettingsKeys,
  checkBackendTypeMigration,
  listRepos,
  type RegisteredRepo,
} from "./doctor-checks";
import {
  checkConfigPermissions,
  checkRepoMemoryManagerTypes,
  checkMemoryImplementationCompatibility,
  checkStaleParents,
  checkMemoryManagerCliAvailability,
  checkRegistryConsistency,
  checkActiveKnotsLeases,
} from "./doctor-repo-checks";
import { applyFix } from "./doctor-fixes";
import type {
  Diagnostic,
  DoctorReport,
  DoctorFixReport,
  DoctorStreamEvent,
  DoctorCheckStatus,
  FixStrategies,
} from "./doctor-types";

// ── Re-export all public types ──────────────────────────

export type {
  DiagnosticSeverity,
  FixOption,
  Diagnostic,
  FixResult,
  DoctorReport,
  DoctorFixReport,
  DoctorCheckStatus,
  DoctorCheckResult,
  DoctorStreamSummary,
  DoctorStreamEvent,
  FixStrategyEntry,
  FixStrategies,
} from "./doctor-types";

// ── Re-export all check functions ───────────────────────

export {
  checkAgents,
  checkUpdates,
  checkSettingsDefaults,
  checkStaleSettingsKeys,
  checkBackendTypeMigration,
} from "./doctor-checks";
export {
  checkConfigPermissions,
  checkRepoMemoryManagerTypes,
  checkMemoryImplementationCompatibility,
  checkStaleParents,
  checkMemoryManagerCliAvailability,
  checkRegistryConsistency,
  checkActiveKnotsLeases,
} from "./doctor-repo-checks";

// ── Run all checks ──────────────────────────────────────

export async function runDoctor(): Promise<DoctorReport> {
  const repos = await listRepos();

  const [
    agentDiags,
    updateDiags,
    configPermDiags,
    settingsDiags,
    staleSettingsDiags,
    backendTypeDiags,
    repoMmDiags,
    memCompatDiags,
    staleDiags,
    cliAvailDiags,
    regConsistDiags,
    knotsLeaseDiags,
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
    checkActiveKnotsLeases(repos),
  ]);

  const diagnostics = [
    ...agentDiags,
    ...updateDiags,
    ...configPermDiags,
    ...settingsDiags,
    ...staleSettingsDiags,
    ...backendTypeDiags,
    ...repoMmDiags,
    ...memCompatDiags,
    ...staleDiags,
    ...cliAvailDiags,
    ...regConsistDiags,
    ...knotsLeaseDiags,
  ];

  return {
    timestamp: new Date().toISOString(),
    diagnostics,
    summary: {
      errors: diagnostics.filter(
        (d) => d.severity === "error",
      ).length,
      warnings: diagnostics.filter(
        (d) => d.severity === "warning",
      ).length,
      infos: diagnostics.filter(
        (d) => d.severity === "info",
      ).length,
      fixable: diagnostics.filter(
        (d) => d.fixable,
      ).length,
    },
  };
}

// ── Streaming generator ─────────────────────────────────

function buildCategorySummary(
  diags: Diagnostic[],
): { status: DoctorCheckStatus; summary: string } {
  const errors = diags.filter(
    (d) => d.severity === "error",
  );
  const warnings = diags.filter(
    (d) => d.severity === "warning",
  );

  if (errors.length > 0) {
    const count = errors.length;
    return {
      status: "fail",
      summary:
        `${count} issue${count !== 1 ? "s" : ""}`,
    };
  }
  if (warnings.length > 0) {
    const count = warnings.length;
    return {
      status: "warning",
      summary:
        `${count} warning${count !== 1 ? "s" : ""}`,
    };
  }

  if (diags.length > 0) {
    const first = diags[0];
    if (first.check === "agent-ping") {
      const agents = diags
        .map((d) => d.context?.agentId)
        .filter(Boolean);
      return {
        status: "pass",
        summary:
          `${agents.join(", ")} ` +
          `${agents.length === 1 ? "is" : "are"} healthy`,
      };
    }
    if (
      first.check === "updates" &&
      first.message.includes("up to date")
    ) {
      const m = first.message.match(/\(([^)]+)\)/);
      return {
        status: "pass",
        summary:
          `up to date${m ? ` (${m[1]})` : ""}`,
      };
    }
  }

  return { status: "pass", summary: "no issues" };
}

type DoctorCheck = {
  category: string;
  label: string;
  run: () => Promise<Diagnostic[]>;
};

function buildCheckList(
  repos: RegisteredRepo[],
): DoctorCheck[] {
  return [
    {
      category: "agents",
      label: "Agent connectivity",
      run: () => checkAgents(),
    },
    {
      category: "updates",
      label: "Version",
      run: () => checkUpdates(),
    },
    {
      category: "config-permissions",
      label: "Config permissions",
      run: () => checkConfigPermissions(),
    },
    {
      category: "settings-defaults",
      label: "Settings defaults",
      run: () => checkSettingsDefaults(),
    },
    {
      category: "settings-stale-keys",
      label: "Settings stale keys",
      run: () => checkStaleSettingsKeys(),
    },
    {
      category: "backend-type-migration",
      label: "Backend type",
      run: () => checkBackendTypeMigration(),
    },
    {
      category: "repo-memory-managers",
      label: "Repo memory managers",
      run: () => checkRepoMemoryManagerTypes(),
    },
    {
      category: "memory-implementation",
      label: "Memory implementation",
      run: () =>
        checkMemoryImplementationCompatibility(repos),
    },
    {
      category: "stale-parents",
      label: "Stale parents",
      run: () => checkStaleParents(repos),
    },
    {
      category: "memory-manager-cli",
      label: "Memory manager CLI",
      run: () =>
        checkMemoryManagerCliAvailability(repos),
    },
    {
      category: "registry-consistency",
      label: "Registry consistency",
      run: () => checkRegistryConsistency(repos),
    },
    {
      category: "active-knots-leases",
      label: "Active Knots leases",
      run: () => checkActiveKnotsLeases(repos),
    },
  ];
}

function runCheckSafe(
  check: DoctorCheck,
): Promise<Diagnostic[]> {
  return check.run().catch((e) => {
    const msg = e instanceof Error
      ? e.message
      : String(e);
    return [{
      check: check.category,
      severity: "error" as const,
      message: msg,
      fixable: false,
    }];
  });
}

export async function* streamDoctor(): AsyncGenerator<
  DoctorStreamEvent
> {
  const repos = await listRepos();
  const checks = buildCheckList(repos);

  let passed = 0;
  let failed = 0;
  let warned = 0;
  let fixable = 0;

  for (const check of checks) {
    const diags = await runCheckSafe(check);

    const { status, summary } =
      buildCategorySummary(diags);
    fixable += diags.filter((d) => d.fixable).length;

    if (status === "pass") passed++;
    else if (status === "fail") failed++;
    else warned++;

    yield {
      category: check.category,
      label: check.label,
      status,
      summary,
      diagnostics: diags,
    };
  }

  yield { done: true, passed, failed, warned, fixable };
}

// ── Fix ─────────────────────────────────────────────────

function matchesAnyContext(
  ctx: Record<string, string> | undefined,
  targets: Record<string, string>[],
): boolean {
  if (!ctx) return false;
  return targets.some((target) =>
    Object.entries(target).every(
      ([k, v]) => ctx[k] === v,
    ),
  );
}

export async function runDoctorFix(
  strategies?: FixStrategies,
): Promise<DoctorFixReport> {
  const report = await runDoctor();
  const fixable = report.diagnostics.filter(
    (d) => d.fixable,
  );
  const fixes: import("./doctor-types").FixResult[] = [];

  for (const diag of fixable) {
    if (strategies && !(diag.check in strategies)) {
      continue;
    }

    const entry = strategies?.[diag.check];
    let strategy: string | undefined;
    if (typeof entry === "string") {
      strategy = entry;
    } else if (entry) {
      strategy = entry.strategy;
      if (
        entry.contexts &&
        !matchesAnyContext(diag.context, entry.contexts)
      ) {
        continue;
      }
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
