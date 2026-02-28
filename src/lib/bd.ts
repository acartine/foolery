import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Bead, BeadDependency, BdResult, MemoryWorkflowDescriptor } from "./types";
import { recordCompatStatusConsumed } from "./compat-status-usage";
import {
  beadsProfileDescriptor,
  deriveBeadsProfileId,
  deriveBeadsWorkflowState,
  deriveWorkflowRuntimeState,
  beadsProfileWorkflowDescriptors,
  isWorkflowProfileLabel,
  isWorkflowStateLabel,
  mapStatusToDefaultWorkflowState,
  normalizeStateForWorkflow,
  withWorkflowProfileLabel,
  withWorkflowStateLabel,
} from "./workflows";

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
const LOCKS_ROOT_DIR =
  process.env.FOOLERY_BD_LOCK_DIR ??
  (process.env.VITEST
    ? join(tmpdir(), `foolery-bd-locks-test-${process.pid}`)
    : join(tmpdir(), "foolery-bd-locks"));
const LOCK_FILE_NAME = "owner.json";
const LOCK_TIMEOUT_SIGNATURE = "Timed out waiting for bd repo lock";
const COMMAND_TIMEOUT_SIGNATURE = "bd command timed out after";
const COMMAND_TIMEOUT_MS = envInt("FOOLERY_BD_COMMAND_TIMEOUT_MS", 5_000);
const LOCK_WAIT_TIMEOUT_MS = envInt("FOOLERY_BD_LOCK_WAIT_TIMEOUT_MS", COMMAND_TIMEOUT_MS);
const LOCK_POLL_MS = envInt("FOOLERY_BD_LOCK_POLL_MS", 50);
const LOCK_STALE_MS = envInt("FOOLERY_BD_LOCK_STALE_MS", 10 * 60_000);
const READ_COMMAND_TIMEOUT_MS = envInt("FOOLERY_BD_READ_TIMEOUT_MS", COMMAND_TIMEOUT_MS);
const WRITE_COMMAND_TIMEOUT_MS = envInt("FOOLERY_BD_WRITE_TIMEOUT_MS", COMMAND_TIMEOUT_MS);
const MAX_TIMEOUT_RETRIES = 1;

interface RepoLockOwner {
  pid: number;
  repoPath: string;
  acquiredAt: string;
}

function baseArgs(): string[] {
  const args: string[] = [];
  if (BD_DB) args.push("--db", BD_DB);
  return args;
}

type ExecResult = { stdout: string; stderr: string; exitCode: number; timedOut: boolean };
type ExecOptions = { cwd?: string; forceNoDb?: boolean };

function repoQueueKey(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockDirForRepo(repoPath: string): string {
  const digest = createHash("sha1").update(repoPath).digest("hex");
  return join(LOCKS_ROOT_DIR, digest);
}

async function readLockOwner(lockDir: string): Promise<RepoLockOwner | null> {
  const ownerPath = join(lockDir, LOCK_FILE_NAME);
  try {
    const raw = await readFile(ownerPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RepoLockOwner>;
    if (
      typeof parsed.pid === "number" &&
      typeof parsed.repoPath === "string" &&
      typeof parsed.acquiredAt === "string"
    ) {
      return {
        pid: parsed.pid,
        repoPath: parsed.repoPath,
        acquiredAt: parsed.acquiredAt,
      };
    }
    return null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    return null;
  }
}

async function evictStaleRepoLock(lockDir: string): Promise<boolean> {
  const owner = await readLockOwner(lockDir);
  if (owner && !isPidAlive(owner.pid)) {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }

  try {
    const lockStat = await stat(lockDir);
    if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
      await rm(lockDir, { recursive: true, force: true });
      return true;
    }
  } catch (error) {
    if (isNotFoundError(error)) return true;
  }

  return false;
}

async function acquireRepoProcessLock(cwd?: string): Promise<() => Promise<void>> {
  const repoPath = repoQueueKey(cwd);
  const lockDir = lockDirForRepo(repoPath);
  const waitStart = Date.now();

  await mkdir(LOCKS_ROOT_DIR, { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      const owner: RepoLockOwner = {
        pid: process.pid,
        repoPath,
        acquiredAt: new Date().toISOString(),
      };
      await writeFile(join(lockDir, LOCK_FILE_NAME), JSON.stringify(owner), "utf8");
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;

      const evicted = await evictStaleRepoLock(lockDir);
      if (evicted) continue;

      if (Date.now() - waitStart >= LOCK_WAIT_TIMEOUT_MS) {
        const owner = await readLockOwner(lockDir);
        const ownerDetails = owner
          ? ` (owner pid=${owner.pid}, acquiredAt=${owner.acquiredAt})`
          : "";
        throw new Error(
          `Timed out waiting for bd repo lock for ${repoPath} after ${LOCK_WAIT_TIMEOUT_MS}ms${ownerDetails}`
        );
      }

      await sleep(LOCK_POLL_MS);
    }
  }
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

  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    releaseQueue = resolveGate;
  });

  const waitForTurn = state.tail;
  state.tail = waitForTurn.then(
    () => gate,
    () => gate
  );
  state.pending += 1;

  let releaseRepoLock: (() => Promise<void>) | null = null;
  try {
    await waitForTurn;
    releaseRepoLock = await acquireRepoProcessLock(cwd);
    return await run();
  } finally {
    if (releaseRepoLock) {
      try {
        await releaseRepoLock();
      } catch {
        // Best effort unlock; stale lock eviction handles orphaned locks.
      }
    }
    releaseQueue();
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

function isIdempotentWriteCommand(args: string[]): boolean {
  const [command, subcommand] = args;
  if (isReadOnlyCommand(args)) return false;
  if (command === "update") return true;
  if (command === "label" && (subcommand === "add" || subcommand === "remove")) return true;
  if (command === "sync") return true;
  if (command === "dep" && subcommand === "remove") return true;
  return false;
}

function canRetryAfterTimeout(args: string[]): boolean {
  return isReadOnlyCommand(args) || isIdempotentWriteCommand(args);
}

function commandTimeoutMs(args: string[]): number {
  return isReadOnlyCommand(args) ? READ_COMMAND_TIMEOUT_MS : WRITE_COMMAND_TIMEOUT_MS;
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

function isLockWaitTimeoutMessage(message: string): boolean {
  return message.includes(LOCK_TIMEOUT_SIGNATURE);
}

function isTimeoutFailure(result: ExecResult): boolean {
  return result.timedOut || result.stderr.includes(COMMAND_TIMEOUT_SIGNATURE);
}

async function execOnce(
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  const env = { ...process.env };
  if (options?.forceNoDb) {
    env[BD_NO_DB_FLAG] = "true";
  }
  const timeoutMs = commandTimeoutMs(args);

  return new Promise((resolve) => {
    execFile(
      BD_BIN,
      [...baseArgs(), ...args],
      { env, cwd: options?.cwd, timeout: timeoutMs, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        const execError = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        let stderrText = (stderr ?? "").trim();
        if (execError?.killed) {
          const timeoutMsg = `bd command timed out after ${timeoutMs}ms`;
          stderrText = stderrText ? `${timeoutMsg}\n${stderrText}` : timeoutMsg;
        }
        const exitCode =
          execError && typeof execError.code === "number" ? execError.code : execError ? 1 : 0;
        resolve({
          stdout: (stdout ?? "").trim(),
          stderr: stderrText,
          exitCode,
          timedOut: Boolean(execError?.killed),
        });
      }
    );
  });
}

async function execSerializedAttempt(
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

async function exec(
  args: string[],
  options?: ExecOptions
): Promise<ExecResult> {
  const maxAttempts = canRetryAfterTimeout(args) ? 1 + MAX_TIMEOUT_RETRIES : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result: ExecResult;
    try {
      result = await execSerializedAttempt(args, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run bd command";
      result = {
        stdout: "",
        stderr: message,
        exitCode: 1,
        timedOut: isLockWaitTimeoutMessage(message),
      };
    }

    if (result.exitCode === 0) return result;

    const shouldRetry = attempt < maxAttempts && isTimeoutFailure(result);
    if (shouldRetry) continue;
    return result;
  }

  return {
    stdout: "",
    stderr: "Failed to run bd command",
    exitCode: 1,
    timedOut: false,
  };
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
  const labels = ((raw.labels ?? []) as string[]).filter(l => l.trim() !== "");
  const metadata = raw.metadata as Record<string, unknown> | undefined;
  const profileId = deriveBeadsProfileId(labels, metadata);
  const workflow = beadsProfileDescriptor(profileId);
  const rawStatus = (raw.status ?? "open") as Bead["status"];
  const workflowState = deriveBeadsWorkflowState(rawStatus, labels, workflow);
  const runtime = deriveWorkflowRuntimeState(workflow, workflowState);
  return {
    ...raw,
    type: (raw.issue_type ?? raw.type ?? "task") as Bead["type"],
    status: runtime.compatStatus,
    compatStatus: runtime.compatStatus,
    workflowId: workflow.id,
    workflowMode: workflow.mode,
    workflowState: runtime.workflowState,
    profileId: workflow.id,
    nextActionState: runtime.nextActionState,
    nextActionOwnerKind: runtime.nextActionOwnerKind,
    requiresHumanAction: runtime.requiresHumanAction,
    isAgentClaimable: runtime.isAgentClaimable,
    priority: (raw.priority ?? 2) as Bead["priority"],
    acceptance: (raw.acceptance_criteria ?? raw.acceptance) as string | undefined,
    parent: inferParent(id, raw.parent, raw.dependencies),
    created: (raw.created_at ?? raw.created) as string,
    updated: (raw.updated_at ?? raw.updated) as string,
    estimate: (raw.estimated_minutes ?? raw.estimate) as number | undefined,
    labels,
  } as Bead;
}

function normalizeBeads(raw: string): Bead[] {
  const items = JSON.parse(raw) as Record<string, unknown>[];
  return items.map(normalizeBead);
}

function applyWorkflowFilters(
  beads: Bead[],
  filters?: Record<string, string>,
): Bead[] {
  if (!filters) return beads;
  return beads.filter((bead) => {
    if (filters.workflowId && bead.workflowId !== filters.workflowId) return false;
    if (filters.workflowState && bead.workflowState !== filters.workflowState) return false;
    if (filters.profileId && bead.profileId !== filters.profileId) return false;
    if (filters.requiresHumanAction !== undefined) {
      const wantsHuman = filters.requiresHumanAction === "true";
      if ((bead.requiresHumanAction ?? false) !== wantsHuman) return false;
    }
    if (filters.nextOwnerKind && bead.nextActionOwnerKind !== filters.nextOwnerKind) return false;
    return true;
  });
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

export async function listWorkflows(
  _repoPath?: string
): Promise<BdResult<MemoryWorkflowDescriptor[]>> {
  return { ok: true, data: beadsProfileWorkflowDescriptors() };
}

export async function listBeads(
  filters?: Record<string, string>,
  repoPath?: string
): Promise<BdResult<Bead[]>> {
  const args = ["list", "--json", "--limit", "0"];
  const hasStatusFilter = filters && filters.status;
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      if (
        key === "workflowId" ||
        key === "workflowState" ||
        key === "profileId" ||
        key === "requiresHumanAction" ||
        key === "nextOwnerKind"
      ) {
        continue;
      }
      if (val) args.push(`--${key}`, val);
    }
  }
  if (!hasStatusFilter) {
    args.push("--all");
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd list failed" };
  try {
    return { ok: true, data: applyWorkflowFilters(normalizeBeads(stdout), filters) };
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
      if (
        key === "workflowId" ||
        key === "workflowState" ||
        key === "profileId" ||
        key === "requiresHumanAction" ||
        key === "nextOwnerKind"
      ) {
        continue;
      }
      if (val) args.push(`--${key}`, val);
    }
  }
  const { stdout, stderr, exitCode } = await exec(args, { cwd: repoPath });
  if (exitCode !== 0) return { ok: false, error: stderr || "bd ready failed" };
  try {
    return { ok: true, data: applyWorkflowFilters(normalizeBeads(stdout), filters) };
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
      if (
        key === "workflowId" ||
        key === "workflowState" ||
        key === "profileId" ||
        key === "requiresHumanAction" ||
        key === "nextOwnerKind"
      ) {
        continue;
      }
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
    return { ok: true, data: applyWorkflowFilters(normalizeBeads(stdout), filters) };
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
  const nextFields: Record<string, string | string[] | number | undefined> = { ...fields };
  const selectedProfileId =
    typeof nextFields.profileId === "string"
      ? nextFields.profileId
      : typeof nextFields.workflowId === "string"
        ? nextFields.workflowId
        : null;
  delete nextFields.profileId;
  delete nextFields.workflowId;
  const workflow = beadsProfileDescriptor(selectedProfileId);

  const explicitWorkflowState =
    typeof nextFields.workflowState === "string"
      ? normalizeStateForWorkflow(nextFields.workflowState, workflow)
      : undefined;
  delete nextFields.workflowState;

  const explicitStatus = typeof nextFields.status === "string"
    ? (nextFields.status as Bead["status"])
    : undefined;
  if (explicitStatus !== undefined) {
    recordCompatStatusConsumed("bd:create-input-status");
  }
  const workflowState =
    explicitWorkflowState ||
    (explicitStatus ? mapStatusToDefaultWorkflowState(explicitStatus, workflow) : workflow.initialState);
  const compatStatus = explicitStatus ?? deriveWorkflowRuntimeState(workflow, workflowState).compatStatus;
  nextFields.status = compatStatus;

  const existingLabels = Array.isArray(nextFields.labels)
    ? nextFields.labels.filter((label): label is string => typeof label === "string")
    : [];
  nextFields.labels = withWorkflowProfileLabel(
    withWorkflowStateLabel(existingLabels, workflowState),
    workflow.id,
  );

  const args = ["create", "--json"];
  for (const [key, val] of Object.entries(nextFields)) {
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
  const nextFields: Record<string, string | string[] | number | undefined> = { ...fields };
  const selectedProfileId =
    typeof nextFields.profileId === "string"
      ? nextFields.profileId
      : typeof nextFields.workflowId === "string"
        ? nextFields.workflowId
        : null;
  delete nextFields.profileId;
  delete nextFields.workflowId;

  const needsCurrentContext = Boolean(selectedProfileId) ||
    typeof nextFields.workflowState === "string" ||
    typeof nextFields.status === "string";
  const current = needsCurrentContext ? await showBead(id, repoPath) : null;
  if (current && !current.ok) {
    return { ok: false, error: current.error || "Failed to load bead before update" };
  }

  const workflow = beadsProfileDescriptor(selectedProfileId ?? current?.data?.profileId);
  const explicitWorkflowState =
    typeof nextFields.workflowState === "string"
      ? normalizeStateForWorkflow(nextFields.workflowState, workflow)
      : undefined;
  delete nextFields.workflowState;

  const explicitStatus = typeof nextFields.status === "string"
    ? (nextFields.status as Bead["status"])
    : undefined;
  if (explicitStatus !== undefined) {
    recordCompatStatusConsumed("bd:update-input-status");
  }
  const workflowState = explicitWorkflowState ||
    (explicitStatus ? mapStatusToDefaultWorkflowState(explicitStatus, workflow) : undefined) ||
    (selectedProfileId ? normalizeStateForWorkflow(current?.data?.workflowState, workflow) : undefined);
  if (workflowState || selectedProfileId) {
    const resolvedState = workflowState ?? workflow.initialState;
    nextFields.status = explicitStatus ?? deriveWorkflowRuntimeState(workflow, resolvedState).compatStatus;
    const existingLabels = Array.isArray(nextFields.labels)
      ? nextFields.labels.filter((label): label is string => typeof label === "string")
      : [];
    const currentLabels = (current?.data?.labels ?? []).filter(
      (label) => !isStageLabel(label) && !isWorkflowStateLabel(label) && !isWorkflowProfileLabel(label),
    );
    const mergedLabels = normalizeLabels([...currentLabels, ...existingLabels]);
    nextFields.labels = withWorkflowProfileLabel(
      withWorkflowStateLabel(mergedLabels, resolvedState),
      workflow.id,
    );
  }

  // Separate label operations from field updates because
  // bd update --remove-label / --set-labels are broken;
  // only bd label add/remove actually persists.
  const labelsToRemove: string[] = [];
  const labelsToAdd: string[] = [];
  const args = ["update", id];
  let hasUpdateFields = false;

  for (const [key, val] of Object.entries(nextFields)) {
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

  let updatePromise: Promise<ExecResult> | null = null;

  // Stage labels are mutually exclusive in this workflow. If callers add any
  // stage:* label, automatically remove other current stage:* labels so
  // regressions in frontend payload construction can't leave stale stage labels.
  const mutatesStageLabels =
    normalizedLabelsToAdd.some(isStageLabel) ||
    normalizedLabelsToRemove.some(isStageLabel);
  const mutatesWorkflowLabels =
    normalizedLabelsToAdd.some((label) => isWorkflowStateLabel(label) || isWorkflowProfileLabel(label)) ||
    normalizedLabelsToRemove.some((label) => isWorkflowStateLabel(label) || isWorkflowProfileLabel(label));
  if (mutatesStageLabels || mutatesWorkflowLabels) {
    const current = await showBead(id, repoPath);
    if (!current.ok || !current.data) {
      return { ok: false, error: current.error || "Failed to load bead before label update" };
    }

    if (mutatesStageLabels && normalizedLabelsToAdd.some(isStageLabel)) {
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

    if (
      mutatesWorkflowLabels &&
      normalizedLabelsToAdd.some((label) => isWorkflowStateLabel(label) || isWorkflowProfileLabel(label))
    ) {
      const workflowLabelsToKeep = new Set(
        normalizedLabelsToAdd.filter((label) => isWorkflowStateLabel(label) || isWorkflowProfileLabel(label))
      );
      const extraWorkflowLabels = (current.data.labels ?? []).filter(
        (label) =>
          (isWorkflowStateLabel(label) || isWorkflowProfileLabel(label)) &&
          !workflowLabelsToKeep.has(label)
      );
      normalizedLabelsToRemove = normalizeLabels([
        ...normalizedLabelsToRemove,
        ...extraWorkflowLabels,
      ]);
    }
  }

  // Run field update after label reconciliation context is resolved so
  // failures cannot leak background retries past an early return.
  updatePromise = hasUpdateFields
    ? exec(args, { cwd: repoPath })
    : null;

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
