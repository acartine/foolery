/**
 * bd query / list / show / search operations.
 *
 * Extracted from bd.ts to keep each module within
 * the 500-line file-length limit.
 */
import { exec } from "./bd-internal";
import { includeActiveAncestors } from "./active-ancestor-filter";
import type {
  Beat,
  BdResult,
  MemoryWorkflowDescriptor,
} from "./types";
import {
  builtinProfileDescriptor,
  builtinWorkflowDescriptors,
  deriveWorkflowRuntimeState,
  workflowStatePhase,
} from "./workflows";
import {
  deriveBeadsProfileId,
  deriveBeadsWorkflowState,
} from "./backends/beads-compat-status";

// ── Beat normalization ──────────────────────────────────────

/** Resolve parent from explicit field, deps, or dot. */
function inferParent(
  id: string,
  explicit?: unknown,
  dependencies?: unknown,
): string | undefined {
  if (typeof explicit === "string" && explicit) {
    return explicit;
  }
  if (Array.isArray(dependencies)) {
    for (const dep of dependencies) {
      if (
        dep &&
        typeof dep === "object" &&
        dep.type === "parent-child" &&
        typeof dep.depends_on_id === "string"
      ) {
        return dep.depends_on_id;
      }
    }
  }
  const dotIdx = id.lastIndexOf(".");
  if (dotIdx === -1) return undefined;
  return id.slice(0, dotIdx);
}

/** Map bd CLI JSON fields to our Beat interface. */
function normalizeBeat(
  raw: Record<string, unknown>,
): Beat {
  const id = raw.id as string;
  const labels = (
    (raw.labels ?? []) as string[]
  ).filter((l) => l.trim() !== "");
  const metadata =
    raw.metadata as Record<string, unknown> | undefined;
  const profileId = deriveBeadsProfileId(
    labels, metadata,
  );
  const workflow = builtinProfileDescriptor(profileId);
  const rawStatus = (raw.status ?? "open") as string;
  const workflowState = deriveBeadsWorkflowState(
    rawStatus, labels, metadata,
  );
  const runtime = deriveWorkflowRuntimeState(
    workflow, workflowState,
  );
  return {
    ...raw,
    type: (raw.issue_type ?? raw.type ?? "task") as
      Beat["type"],
    state: runtime.state,
    workflowId: workflow.id,
    workflowMode: workflow.mode,
    profileId: workflow.id,
    nextActionState: runtime.nextActionState,
    nextActionOwnerKind: runtime.nextActionOwnerKind,
    requiresHumanAction: runtime.requiresHumanAction,
    isAgentClaimable: runtime.isAgentClaimable,
    priority: (raw.priority ?? 2) as Beat["priority"],
    acceptance: (
      raw.acceptance_criteria ?? raw.acceptance
    ) as string | undefined,
    parent: inferParent(
      id, raw.parent, raw.dependencies,
    ),
    created: (raw.created_at ?? raw.created) as string,
    updated: (raw.updated_at ?? raw.updated) as string,
    estimate: (
      raw.estimated_minutes ?? raw.estimate
    ) as number | undefined,
    labels,
  } as Beat;
}

function normalizeBeats(raw: string): Beat[] {
  const items = JSON.parse(raw) as
    Record<string, unknown>[];
  return items.map(normalizeBeat);
}

// ── Workflow filters ────────────────────────────────────────

function applyWorkflowFilters(
  beats: Beat[],
  filters?: Record<string, string>,
): Beat[] {
  if (!filters) return beats;
  const isActivePhaseFilter =
    filters.state === "in_action";
  const filtered = beats.filter((beat) => {
    if (
      filters.workflowId &&
      beat.workflowId !== filters.workflowId
    ) {
      return false;
    }
    if (filters.state) {
      const beatWorkflow = builtinProfileDescriptor(
        beat.profileId ?? beat.workflowId,
      );
      if (filters.state === "queued") {
        if (
          workflowStatePhase(beatWorkflow, beat.state) !== "queued"
        ) {
          return false;
        }
      } else if (filters.state === "in_action") {
        if (
          workflowStatePhase(beatWorkflow, beat.state) !== "active"
        ) {
          return false;
        }
      } else if (beat.state !== filters.state) {
        return false;
      }
    }
    if (
      filters.profileId &&
      beat.profileId !== filters.profileId
    ) {
      return false;
    }
    if (filters.requiresHumanAction !== undefined) {
      const wantsHuman =
        filters.requiresHumanAction === "true";
      if (
        (beat.requiresHumanAction ?? false) !== wantsHuman
      ) {
        return false;
      }
    }
    if (
      filters.nextOwnerKind &&
      beat.nextActionOwnerKind !== filters.nextOwnerKind
    ) {
      return false;
    }
    return true;
  });

  if (isActivePhaseFilter) {
    return includeActiveAncestors(beats, filtered);
  }

  return filtered;
}

// ── Workflow filter skip keys ───────────────────────────────

const WORKFLOW_ONLY_KEYS = new Set([
  "workflowId",
  "workflowState",
  "state",
  "profileId",
  "requiresHumanAction",
  "nextOwnerKind",
]);

function isWorkflowOnlyKey(key: string): boolean {
  return WORKFLOW_ONLY_KEYS.has(key);
}

// ── Public query functions ──────────────────────────────────

export async function listWorkflows(): Promise<BdResult<MemoryWorkflowDescriptor[]>> {
  return { ok: true, data: builtinWorkflowDescriptors() };
}

export async function listBeats(
  filters?: Record<string, string>,
  repoPath?: string,
): Promise<BdResult<Beat[]>> {
  const args = ["list", "--json", "--limit", "0"];
  const hasStatusFilter =
    filters && (filters.status || filters.state);
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (isWorkflowOnlyKey(key)) continue;
      if (val) args.push(`--${key}`, val);
    }
  }
  if (!hasStatusFilter) {
    args.push("--all");
  }
  const { stdout, stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return { ok: false, error: stderr || "bd list failed" };
  }
  try {
    return {
      ok: true,
      data: applyWorkflowFilters(
        normalizeBeats(stdout), filters,
      ),
    };
  } catch {
    return {
      ok: false,
      error: "Failed to parse bd list output",
    };
  }
}

export async function readyBeats(
  filters?: Record<string, string>,
  repoPath?: string,
): Promise<BdResult<Beat[]>> {
  const args = ["ready", "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (isWorkflowOnlyKey(key)) continue;
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd ready failed",
    };
  }
  try {
    return {
      ok: true,
      data: applyWorkflowFilters(
        normalizeBeats(stdout), filters,
      ),
    };
  } catch {
    return {
      ok: false,
      error: "Failed to parse bd ready output",
    };
  }
}

export async function searchBeats(
  query: string,
  filters?: Record<string, string>,
  repoPath?: string,
): Promise<BdResult<Beat[]>> {
  const args = [
    "search", query, "--json", "--limit", "0",
  ];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      if (isWorkflowOnlyKey(key)) continue;
      if (key === "priority") {
        args.push(
          "--priority-min", val,
          "--priority-max", val,
        );
      } else {
        args.push(`--${key}`, val);
      }
    }
  }
  const { stdout, stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd search failed",
    };
  }
  try {
    return {
      ok: true,
      data: applyWorkflowFilters(
        normalizeBeats(stdout), filters,
      ),
    };
  } catch {
    return {
      ok: false,
      error: "Failed to parse bd search output",
    };
  }
}

export async function queryBeats(
  expression: string,
  options?: { limit?: number; sort?: string },
  repoPath?: string,
): Promise<BdResult<Beat[]>> {
  const args = ["query", expression, "--json"];
  if (options?.limit) {
    args.push("--limit", String(options.limit));
  }
  if (options?.sort) {
    args.push("--sort", options.sort);
  }
  const { stdout, stderr, exitCode } = await exec(
    args, { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd query failed",
    };
  }
  try {
    return { ok: true, data: normalizeBeats(stdout) };
  } catch {
    return {
      ok: false,
      error: "Failed to parse bd query output",
    };
  }
}

export async function showBeat(
  id: string,
  repoPath?: string,
): Promise<BdResult<Beat>> {
  const { stdout, stderr, exitCode } = await exec(
    ["show", id, "--json"], { cwd: repoPath },
  );
  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr || "bd show failed",
    };
  }
  try {
    const parsed = JSON.parse(stdout);
    const item = Array.isArray(parsed)
      ? parsed[0]
      : parsed;
    return {
      ok: true,
      data: normalizeBeat(
        item as Record<string, unknown>,
      ),
    };
  } catch {
    return {
      ok: false,
      error: "Failed to parse bd show output",
    };
  }
}

