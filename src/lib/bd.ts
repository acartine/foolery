import { execFile } from "node:child_process";
import { resolve } from "node:path";
import type { Bead, BeadDependency, BdResult } from "./types";

const BD_BIN = process.env.BD_BIN ?? "bd";
const BD_DB = process.env.BD_DB;
const OUT_OF_SYNC_SIGNATURE = "Database out of sync with JSONL";
const NO_DAEMON_FLAG = "--no-daemon";
const BD_NO_DB_FLAG = "BD_NO_DB";
const READ_NO_DB_DISABLE_FLAG = "FOOLERY_BD_READ_NO_DB";
const DOLT_NIL_PANIC_SIGNATURE = "panic: runtime error: invalid memory address or nil pointer dereference";
const DOLT_PANIC_STACK_SIGNATURE = "SetCrashOnFatalError";
const READ_ONLY_BD_COMMANDS = new Set(["list", "ready", "search", "query", "show"]);
const repoExecQueues = new Map<string, { tail: Promise<void>; pending: number }>();

function baseArgs(): string[] {
  const args: string[] = [];
  if (BD_DB) args.push("--db", BD_DB);
  return args;
}

type ExecResult = { stdout: string; stderr: string; exitCode: number };
type ExecOptions = { cwd?: string; forceNoDb?: boolean };

function repoQueueKey(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

async function withRepoSerialization<T>(
  cwd: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  const key = repoQueueKey(cwd);
  let state = repoExecQueues.get(key);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0 };
    repoExecQueues.set(key, state);
  }

  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });

  const waitForTurn = state.tail;
  state.tail = waitForTurn.then(
    () => gate,
    () => gate
  );
  state.pending += 1;

  try {
    await waitForTurn;
    return await run();
  } finally {
    release();
    state.pending -= 1;
    if (state.pending === 0) {
      repoExecQueues.delete(key);
    }
  }
}

function isOutOfSyncError(result: ExecResult): boolean {
  return `${result.stderr}\n${result.stdout}`.includes(OUT_OF_SYNC_SIGNATURE);
}

function isUnknownNoDaemonFlagError(result: ExecResult): boolean {
  return `${result.stderr}\n${result.stdout}`.includes(`unknown flag: ${NO_DAEMON_FLAG}`);
}

function stripNoDaemonFlag(args: string[]): string[] {
  return args.filter((arg) => arg !== NO_DAEMON_FLAG);
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes";
}

function isReadOnlyCommand(args: string[]): boolean {
  if (args[0] === "dep") return args[1] === "list";
  return READ_ONLY_BD_COMMANDS.has(args[0] ?? "");
}

function shouldUseNoDbByDefault(args: string[]): boolean {
  if (isTruthyEnvValue(process.env[BD_NO_DB_FLAG])) return true;
  if (process.env[READ_NO_DB_DISABLE_FLAG] === "0") return false;
  return isReadOnlyCommand(args);
}

function isEmbeddedDoltPanic(result: ExecResult): boolean {
  const combined = `${result.stderr}\n${result.stdout}`;
  return combined.includes(DOLT_NIL_PANIC_SIGNATURE) || combined.includes(DOLT_PANIC_STACK_SIGNATURE);
}

async function execOnce(
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  const env = { ...process.env };
  if (options?.forceNoDb) {
    env[BD_NO_DB_FLAG] = "true";
  }

  return new Promise((resolve) => {
    execFile(BD_BIN, [...baseArgs(), ...args], { env, cwd: options?.cwd }, (error, stdout, stderr) => {
      const exitCode =
        error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        stdout: (stdout ?? "").trim(),
        stderr: (stderr ?? "").trim(),
        exitCode,
      });
    });
  });
}

async function exec(
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  return withRepoSerialization(options?.cwd, async () => {
    const useNoDb = shouldUseNoDbByDefault(args);
    const firstResult = await execOnce(args, { ...options, forceNoDb: useNoDb });
    if (firstResult.exitCode === 0) return firstResult;

    // If read-mode DB bypass is explicitly disabled, still recover from the
    // embedded Dolt nil-pointer panic by retrying once in JSONL mode.
    if (!useNoDb && isReadOnlyCommand(args) && isEmbeddedDoltPanic(firstResult)) {
      const fallbackResult = await execOnce(args, { ...options, forceNoDb: true });
      if (fallbackResult.exitCode === 0) return fallbackResult;
      return fallbackResult;
    }

    if (args[0] === "sync" || !isOutOfSyncError(firstResult)) {
      return firstResult;
    }

    // Auto-heal stale bd SQLite metadata after repo switches/pulls by importing JSONL
    // and retrying the original command once in the same repo.
    const syncResult = await execOnce(["sync", "--import-only"], options);
    if (syncResult.exitCode !== 0) return firstResult;
    return execOnce(args, options);
  });
}

async function execWithNoDaemonFallback(
  args: string[],
  options?: { cwd?: string }
): Promise<ExecResult> {
  const firstResult = await exec(args, options);
  if (firstResult.exitCode === 0) return firstResult;
  if (!args.includes(NO_DAEMON_FLAG) || !isUnknownNoDaemonFlagError(firstResult)) {
    return firstResult;
  }
  return exec(stripNoDaemonFlag(args), options);
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

  // Start field update immediately — don't wait for the stage label check
  const updatePromise = hasUpdateFields
    ? exec(args, { cwd: repoPath })
    : null;

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

  // Await field update if started
  if (updatePromise) {
    const { stderr, exitCode } = await updatePromise;
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
    labelOps.push(
      execWithNoDaemonFallback(["label", "remove", id, label, NO_DAEMON_FLAG], {
        cwd: repoPath,
      })
    );
    labelOpDescs.push(`remove ${label}`);
  }
  for (const label of normalizedLabelsToAdd) {
    labelOps.push(
      execWithNoDaemonFallback(["label", "add", id, label, NO_DAEMON_FLAG], {
        cwd: repoPath,
      })
    );
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

  // Flush to JSONL so the daemon's auto-import picks up the direct DB writes.
  // Only sync after label removals — the daemon persistence bug only affects removes.
  if (normalizedLabelsToRemove.length > 0) {
    const { stderr, exitCode } = await execWithNoDaemonFallback(
      ["sync", NO_DAEMON_FLAG],
      { cwd: repoPath }
    );
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
