import { execFile } from "node:child_process";
import { listBeads } from "./bd";
import { getRegisteredAgents } from "./settings";
import { listRepos, type RegisteredRepo } from "./registry";
import { getReleaseVersionStatus, type ReleaseVersionStatus } from "./release-version";
import type { Bead } from "./types";

// ── Types ──────────────────────────────────────────────────

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  check: string;
  severity: DiagnosticSeverity;
  message: string;
  fixable: boolean;
  /** Context for auto-fix: which bead/repo/agent is affected */
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

// ── Corrupt ticket checks ──────────────────────────────────

/**
 * Finds beads that have stage:verification label but status != in_progress.
 * These are inconsistent and should be fixed.
 */
export async function checkCorruptTickets(repos: RegisteredRepo[]): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    let beads: Bead[];
    try {
      const result = await listBeads(undefined, repo.path);
      if (!result.ok || !result.data) continue;
      beads = result.data;
    } catch {
      diagnostics.push({
        check: "corrupt-tickets",
        severity: "warning",
        message: `Could not list beads for repo "${repo.name}" (${repo.path}).`,
        fixable: false,
        context: { repoPath: repo.path, repoName: repo.name },
      });
      continue;
    }

    for (const bead of beads) {
      const hasVerificationLabel = bead.labels.some((l) => l === "stage:verification");
      if (hasVerificationLabel && bead.status !== "in_progress") {
        diagnostics.push({
          check: "corrupt-ticket-verification",
          severity: "error",
          message: `Bead ${bead.id} ("${bead.title}") has stage:verification label but status is "${bead.status}" (expected "in_progress") in repo "${repo.name}".`,
          fixable: true,
          context: {
            beadId: bead.id,
            repoPath: repo.path,
            repoName: repo.name,
            currentStatus: bead.status,
          },
        });
      }
    }
  }

  return diagnostics;
}

// ── Stale parent checks ────────────────────────────────────

/**
 * Finds parent beads (open or in_progress) where ALL children are closed.
 * These parents should likely be closed too.
 */
export async function checkStaleParents(repos: RegisteredRepo[]): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for (const repo of repos) {
    let beads: Bead[];
    try {
      const result = await listBeads(undefined, repo.path);
      if (!result.ok || !result.data) continue;
      beads = result.data;
    } catch {
      continue;
    }

    const beadMap = new Map<string, Bead>();
    for (const b of beads) {
      beadMap.set(b.id, b);
    }

    // Group children by parent
    const childrenByParent = new Map<string, Bead[]>();
    for (const bead of beads) {
      if (bead.parent) {
        const existing = childrenByParent.get(bead.parent) ?? [];
        existing.push(bead);
        childrenByParent.set(bead.parent, existing);
      }
    }

    for (const [parentId, children] of Array.from(childrenByParent.entries())) {
      const parent = beadMap.get(parentId);
      if (!parent) continue;
      if (parent.status === "closed" || parent.status === "deferred") continue;

      const allChildrenClosed = children.length > 0 && children.every((c) => c.status === "closed");
      if (allChildrenClosed) {
        diagnostics.push({
          check: "stale-parent",
          severity: "warning",
          message: `Parent bead ${parent.id} ("${parent.title}") is "${parent.status}" but all ${children.length} children are closed in repo "${repo.name}".`,
          fixable: true,
          context: {
            beadId: parent.id,
            repoPath: repo.path,
            repoName: repo.name,
            currentStatus: parent.status,
            childCount: String(children.length),
          },
        });
      }
    }
  }

  return diagnostics;
}

// ── Run all checks ─────────────────────────────────────────

export async function runDoctor(): Promise<DoctorReport> {
  const repos = await listRepos();

  const [agentDiags, updateDiags, corruptDiags, staleDiags] = await Promise.all([
    checkAgents(),
    checkUpdates(),
    checkCorruptTickets(repos),
    checkStaleParents(repos),
  ]);

  const diagnostics = [...agentDiags, ...updateDiags, ...corruptDiags, ...staleDiags];

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

// ── Fix ────────────────────────────────────────────────────

export async function runDoctorFix(): Promise<DoctorFixReport> {
  const report = await runDoctor();
  const fixable = report.diagnostics.filter((d) => d.fixable);
  const fixes: FixResult[] = [];

  for (const diag of fixable) {
    const result = await applyFix(diag);
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

async function applyFix(diag: Diagnostic): Promise<FixResult> {
  const ctx = diag.context ?? {};

  switch (diag.check) {
    case "corrupt-ticket-verification": {
      // Fix: set status to in_progress to match the verification label
      const { beadId, repoPath } = ctx;
      if (!beadId || !repoPath) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      try {
        const { updateBead } = await import("./bd");
        const result = await updateBead(beadId, { status: "in_progress" }, repoPath);
        if (!result.ok) {
          return { check: diag.check, success: false, message: result.error ?? "bd update failed", context: ctx };
        }
        return { check: diag.check, success: true, message: `Set ${beadId} status to in_progress.`, context: ctx };
      } catch (e) {
        return { check: diag.check, success: false, message: String(e), context: ctx };
      }
    }

    case "stale-parent": {
      // Fix: add stage:verification label to the parent (don't close — per project rules)
      const { beadId, repoPath } = ctx;
      if (!beadId || !repoPath) {
        return { check: diag.check, success: false, message: "Missing context for fix.", context: ctx };
      }
      try {
        const { updateBead } = await import("./bd");
        const result = await updateBead(beadId, { labels: ["stage:verification"], status: "in_progress" }, repoPath);
        if (!result.ok) {
          return { check: diag.check, success: false, message: result.error ?? "bd update failed", context: ctx };
        }
        return {
          check: diag.check,
          success: true,
          message: `Moved ${beadId} to in_progress with stage:verification label.`,
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
