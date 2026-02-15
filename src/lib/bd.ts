import { execFile } from "node:child_process";
import type { Bead, BeadDependency, BdResult } from "./types";

const BD_BIN = process.env.BD_BIN ?? "bd";
const BD_DB = process.env.BD_DB;

function baseArgs(): string[] {
  const args: string[] = [];
  if (BD_DB) args.push("--db", BD_DB);
  return args;
}

async function exec(
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(BD_BIN, [...baseArgs(), ...args], { env: process.env, cwd: options?.cwd }, (error, stdout, stderr) => {
      resolve({
        stdout: (stdout ?? "").trim(),
        stderr: (stderr ?? "").trim(),
        exitCode: error ? (error.code as number) ?? 1 : 0,
      });
    });
  });
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/** Resolve parent ID from explicit field, dependencies array, or dot notation. */
function inferParent(id: string, explicit?: unknown, dependencies?: unknown): string | undefined {
  if (typeof explicit === "string" && explicit) return explicit;
  // bd list --json doesn't return a top-level parent field, but it includes
  // a dependencies array with type:"parent-child" entries whose depends_on_id
  // is the parent.
  if (Array.isArray(dependencies)) {
    for (const dep of dependencies) {
      if (dep && typeof dep === "object" && dep.type === "parent-child" && typeof dep.depends_on_id === "string") {
        return dep.depends_on_id;
      }
    }
  }
  const dotIdx = id.lastIndexOf(".");
  if (dotIdx === -1) return undefined;
  return id.slice(0, dotIdx);
}

/** Map bd CLI JSON field names to our Bead interface field names. */
function normalizeBead(raw: Record<string, unknown>): Bead {
  const id = raw.id as string;
  return {
    ...raw,
    type: (raw.issue_type ?? raw.type ?? "task") as Bead["type"],
    status: (raw.status ?? "open") as Bead["status"],
    priority: (raw.priority ?? 2) as Bead["priority"],
    acceptance: (raw.acceptance_criteria ?? raw.acceptance) as string | undefined,
    parent: inferParent(id, raw.parent, raw.dependencies),
    created: (raw.created_at ?? raw.created) as string,
    updated: (raw.updated_at ?? raw.updated) as string,
    estimate: (raw.estimated_minutes ?? raw.estimate) as number | undefined,
    labels: ((raw.labels ?? []) as string[]).filter(l => l.trim() !== ""),
  } as Bead;
}

function normalizeBeads(raw: string): Bead[] {
  const items = JSON.parse(raw) as Record<string, unknown>[];
  return items.map(normalizeBead);
}

function normalizeLabels(labels: string[]): string[] {
  const deduped = new Set<string>();
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function isStageLabel(label: string): boolean {
  return label.startsWith("stage:");
}

export async function listBeads(
  filters?: Record<string, string>,
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["list", "--json", "--limit", "0"];
  const hasStatusFilter = filters && filters.status;
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val) args.push(`--${key}`, val);
    }
  }
  if (!hasStatusFilter) {
    args.push("--all");
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd list failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd list output" };
  }
}

export async function readyBeads(
  filters?: Record<string, string>,
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["ready", "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd ready failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd ready output" };
  }
}

export async function searchBeads(
  query: string,
  filters?: Record<string, string>,
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["search", query, "--json", "--limit", "0"];
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      if (key === "priority") {
        args.push("--priority-min", val, "--priority-max", val);
      } else {
        args.push(`--${key}`, val);
      }
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd search failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd search output" };
  }
}

export async function queryBeads(
  expression: string,
  options?: { limit?: number; sort?: string },
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["query", expression, "--json"];
  if (options?.limit) args.push("--limit", String(options.limit));
  if (options?.sort) args.push("--sort", options.sort);
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd query failed" };
  try {
    return { ok: true, data: normalizeBeads(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd query output" };
  }
}

export async function showBead(id: string, repoPath?: string): Promise<BdResult<Bead>> {
  const { stdout, stderr, exitCode } = await exec(["show", id, "--json"], { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd show failed" };
  try {
    const parsed = JSON.parse(stdout);
    const item = Array.isArray(parsed) ? parsed[0] : parsed;
    return { ok: true, data: normalizeBead(item as Record<string, unknown>) };
  } catch {
    return { ok: false, error: "Failed to parse bd show output" };
  }
}

export async function createBead(
  fields: Record<string, string | string[] | number | undefined>,
  repoPath?: string
): Promise<BdResult<{ id: string }>> {
  const args = ["create", "--json"];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined || val === "") continue;
    if (key === "labels" && Array.isArray(val)) {
      args.push("--labels", val.join(","));
    } else {
      args.push(`--${key}`, String(val));
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd create failed" };
  try {
    return { ok: true, data: parseJson<{ id: string }>(stdout) };
  } catch {
    // bd create may output just the ID
    const id = stdout.trim();
    if (id) return { ok: true, data: { id } };
    return { ok: false, error: "Failed to parse bd create output" };
  }
}

export async function updateBead(
  id: string,
  fields: Record<string, string | string[] | number | undefined>,
  repoPath?: string
): Promise<BdResult<void>> {
  // Separate label operations from field updates because
  // bd update --remove-label / --set-labels are broken;
  // only bd label add/remove actually persists.
  const labelsToRemove: string[] = [];
  const labelsToAdd: string[] = [];
  const args = ["update", id];
  let hasUpdateFields = false;

  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    if (key === "removeLabels" && Array.isArray(val)) {
      labelsToRemove.push(...val);
    } else if (key === "labels" && Array.isArray(val)) {
      labelsToAdd.push(...val);
    } else {
      args.push(`--${key}`, String(val));
      hasUpdateFields = true;
    }
  }

  const normalizedLabelsToAdd = normalizeLabels(labelsToAdd);
  let normalizedLabelsToRemove = normalizeLabels(labelsToRemove);

  // Stage labels are mutually exclusive in this workflow. If callers add any
  // stage:* label, automatically remove other current stage:* labels so
  // regressions in frontend payload construction can't leave stale stage labels.
  if (
    normalizedLabelsToAdd.some(isStageLabel) ||
    normalizedLabelsToRemove.some(isStageLabel)
  ) {
    const current = await showBead(id, repoPath);
    if (!current.ok || !current.data) {
      return { ok: false, error: current.error || "Failed to load bead before label update" };
    }

    if (normalizedLabelsToAdd.some(isStageLabel)) {
      const stageLabelsToKeep = new Set(
        normalizedLabelsToAdd.filter(isStageLabel)
      );
      const extraStageLabels = (current.data.labels ?? []).filter(
        (label) => isStageLabel(label) && !stageLabelsToKeep.has(label)
      );
      normalizedLabelsToRemove = normalizeLabels([
        ...normalizedLabelsToRemove,
        ...extraStageLabels,
      ]);
    }
  }

  // Run bd update for non-label fields
  if (hasUpdateFields) {
    const { stderr, exitCode } = await exec(args, { cwd: repoPath });
    if (exitCode !== 0)
      return { ok: false, error: stderr || "bd update failed" };
  }

  // Run all label add/remove operations in parallel.
  // Use --no-daemon to bypass the daemon and write directly to the database.
  // The daemon's label remove command acknowledges success but doesn't persist
  // the removal, causing labels to reappear on the next list/show call.
  const labelOps: Promise<{ stdout: string; stderr: string; exitCode: number }>[] = [];
  const labelOpDescs: string[] = [];

  for (const label of normalizedLabelsToRemove) {
    labelOps.push(exec(["label", "remove", id, label, "--no-daemon"], { cwd: repoPath }));
    labelOpDescs.push(`remove ${label}`);
  }
  for (const label of normalizedLabelsToAdd) {
    labelOps.push(exec(["label", "add", id, label, "--no-daemon"], { cwd: repoPath }));
    labelOpDescs.push(`add ${label}`);
  }

  if (labelOps.length > 0) {
    const results = await Promise.all(labelOps);
    for (let i = 0; i < results.length; i++) {
      if (results[i].exitCode !== 0) {
        return { ok: false, error: results[i].stderr || `bd label ${labelOpDescs[i]} failed` };
      }
    }
  }

  // Flush to JSONL so the daemon's auto-import picks up the direct DB writes
  if (normalizedLabelsToRemove.length > 0 || normalizedLabelsToAdd.length > 0) {
    const { stderr, exitCode } = await exec(["sync", "--no-daemon"], { cwd: repoPath });
    if (exitCode !== 0) {
      return { ok: false, error: stderr || "bd sync failed after label update" };
    }
  }

  return { ok: true };
}

export async function deleteBead(id: string, repoPath?: string): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec(["delete", id, "--force"], { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd delete failed" };
  return { ok: true };
}

export async function closeBead(
  id: string,
  reason?: string,
  repoPath?: string
): Promise<BdResult<void>> {
  const args = ["close", id];
  if (reason) args.push("--reason", reason);
  const { stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd close failed" };
  return { ok: true };
}

export async function listDeps(
  id: string,
  repoPath?: string,
  options?: { type?: string }
): Promise<BdResult<BeadDependency[]>> {
  const args = ["dep", "list", id, "--json"];
  if (options?.type) args.push("--type", options.type);
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd dep list failed" };
  try {
    return { ok: true, data: parseJson<BeadDependency[]>(stdout) };
  } catch {
    return { ok: false, error: "Failed to parse bd dep list output" };
  }
}

export async function addDep(
  blockerId: string,
  blockedId: string,
  repoPath?: string
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec([
    "dep",
    blockerId,
    "--blocks",
    blockedId,
  ], { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd dep add failed" };
  return { ok: true };
}

export async function removeDep(
  blockerId: string,
  blockedId: string,
  repoPath?: string
): Promise<BdResult<void>> {
  const { stderr, exitCode } = await exec([
    "dep",
    "remove",
    blockedId,
    blockerId,
  ], { cwd: repoPath });
  if (exitCode !== 0)
    return { ok: false, error: stderr || "bd dep remove failed" };
  return { ok: true };
}
