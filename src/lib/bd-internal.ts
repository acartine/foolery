/**
 * Internal bd CLI execution plumbing.
 *
 * Handles process-level repo locking, serialization, timeout/retry,
 * out-of-sync auto-healing, and embedded-Dolt panic recovery.
 *
 * Not part of the public API — consumed only by sibling bd-*.ts modules.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── Constants ───────────────────────────────────────────────

const BD_BIN = process.env.BD_BIN ?? "bd";
const BD_DB = process.env.BD_DB;
const OUT_OF_SYNC_SIGNATURE =
  "Database out of sync with JSONL";
const NO_DAEMON_FLAG = "--no-daemon";
const BD_NO_DB_FLAG = "BD_NO_DB";
const READ_NO_DB_DISABLE_FLAG = "FOOLERY_BD_READ_NO_DB";
const DOLT_NIL_PANIC_SIGNATURE =
  "panic: runtime error: " +
  "invalid memory address or nil pointer dereference";
const DOLT_PANIC_STACK_SIGNATURE = "SetCrashOnFatalError";
const READ_ONLY_BD_COMMANDS = new Set([
  "list", "ready", "search", "query", "show",
]);
const repoExecQueues = new Map<
  string,
  { tail: Promise<void>; pending: number }
>();
const LOCKS_ROOT_DIR =
  process.env.FOOLERY_BD_LOCK_DIR ??
  (process.env.VITEST
    ? join(tmpdir(), `foolery-bd-locks-test-${process.pid}`)
    : join(tmpdir(), "foolery-bd-locks"));
const LOCK_FILE_NAME = "owner.json";
const LOCK_TIMEOUT_SIGNATURE =
  "Timed out waiting for bd repo lock";
const COMMAND_TIMEOUT_SIGNATURE =
  "bd command timed out after";
const COMMAND_TIMEOUT_MS = envInt(
  "FOOLERY_BD_COMMAND_TIMEOUT_MS", 5_000,
);
const LOCK_WAIT_TIMEOUT_MS = envInt(
  "FOOLERY_BD_LOCK_WAIT_TIMEOUT_MS", COMMAND_TIMEOUT_MS,
);
const LOCK_POLL_MS = envInt("FOOLERY_BD_LOCK_POLL_MS", 50);
const LOCK_STALE_MS = envInt(
  "FOOLERY_BD_LOCK_STALE_MS", 10 * 60_000,
);
const READ_COMMAND_TIMEOUT_MS = envInt(
  "FOOLERY_BD_READ_TIMEOUT_MS", COMMAND_TIMEOUT_MS,
);
const WRITE_COMMAND_TIMEOUT_MS = envInt(
  "FOOLERY_BD_WRITE_TIMEOUT_MS", COMMAND_TIMEOUT_MS,
);
const MAX_TIMEOUT_RETRIES = 1;

// ── Types ───────────────────────────────────────────────────

interface RepoLockOwner {
  pid: number;
  repoPath: string;
  acquiredAt: string;
}

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};
export type ExecOptions = {
  cwd?: string;
  forceNoDb?: boolean;
};

// ── Small helpers ───────────────────────────────────────────

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function baseArgs(): string[] {
  const args: string[] = [];
  if (BD_DB) args.push("--db", BD_DB);
  return args;
}

function repoQueueKey(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

export function isReadOnlyCommand(args: string[]): boolean {
  if (args[0] === "dep") return args[1] === "list";
  return READ_ONLY_BD_COMMANDS.has(args[0] ?? "");
}

function isTruthyEnvValue(
  value: string | undefined,
): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return (
    lower === "1" || lower === "true" || lower === "yes"
  );
}

function isIdempotentWriteCommand(
  args: string[],
): boolean {
  const [command, subcommand] = args;
  if (isReadOnlyCommand(args)) return false;
  if (command === "update") return true;
  if (
    command === "label" &&
    (subcommand === "add" || subcommand === "remove")
  ) {
    return true;
  }
  if (command === "sync") return true;
  if (command === "dep" && subcommand === "remove") {
    return true;
  }
  return false;
}

function canRetryAfterTimeout(args: string[]): boolean {
  return (
    isReadOnlyCommand(args) ||
    isIdempotentWriteCommand(args)
  );
}

function commandTimeoutMs(args: string[]): number {
  return isReadOnlyCommand(args)
    ? READ_COMMAND_TIMEOUT_MS
    : WRITE_COMMAND_TIMEOUT_MS;
}

function shouldUseNoDbByDefault(
  args: string[],
): boolean {
  if (isTruthyEnvValue(process.env[BD_NO_DB_FLAG])) {
    return true;
  }
  if (process.env[READ_NO_DB_DISABLE_FLAG] === "0") {
    return false;
  }
  return isReadOnlyCommand(args);
}

function isEmbeddedDoltPanic(
  result: ExecResult,
): boolean {
  const combined = `${result.stderr}\n${result.stdout}`;
  return (
    combined.includes(DOLT_NIL_PANIC_SIGNATURE) ||
    combined.includes(DOLT_PANIC_STACK_SIGNATURE)
  );
}

function isOutOfSyncError(result: ExecResult): boolean {
  return `${result.stderr}\n${result.stdout}`.includes(
    OUT_OF_SYNC_SIGNATURE,
  );
}

function isUnknownNoDaemonFlagError(
  result: ExecResult,
): boolean {
  return `${result.stderr}\n${result.stdout}`.includes(
    `unknown flag: ${NO_DAEMON_FLAG}`,
  );
}

function stripNoDaemonFlag(args: string[]): string[] {
  return args.filter((arg) => arg !== NO_DAEMON_FLAG);
}

function isLockWaitTimeoutMessage(
  message: string,
): boolean {
  return message.includes(LOCK_TIMEOUT_SIGNATURE);
}

function isTimeoutFailure(result: ExecResult): boolean {
  return (
    result.timedOut ||
    result.stderr.includes(COMMAND_TIMEOUT_SIGNATURE)
  );
}

// ── Repo locking ────────────────────────────────────────────

function lockDirForRepo(repoPath: string): string {
  const digest = createHash("sha1")
    .update(repoPath)
    .digest("hex");
  return join(LOCKS_ROOT_DIR, digest);
}

async function readLockOwner(
  lockDir: string,
): Promise<RepoLockOwner | null> {
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

async function evictStaleRepoLock(
  lockDir: string,
): Promise<boolean> {
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

async function acquireRepoProcessLock(
  cwd?: string,
): Promise<() => Promise<void>> {
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
      await writeFile(
        join(lockDir, LOCK_FILE_NAME),
        JSON.stringify(owner),
        "utf8",
      );
      return async () => {
        await rm(lockDir, {
          recursive: true,
          force: true,
        });
      };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;

      const evicted = await evictStaleRepoLock(lockDir);
      if (evicted) continue;

      if (
        Date.now() - waitStart >= LOCK_WAIT_TIMEOUT_MS
      ) {
        const owner = await readLockOwner(lockDir);
        const ownerDetails = owner
          ? ` (owner pid=${owner.pid},` +
            ` acquiredAt=${owner.acquiredAt})`
          : "";
        throw new Error(
          `Timed out waiting for bd repo lock` +
          ` for ${repoPath}` +
          ` after ${LOCK_WAIT_TIMEOUT_MS}ms` +
          ownerDetails,
        );
      }

      await sleep(LOCK_POLL_MS);
    }
  }
}

// ── Serialization ───────────────────────────────────────────

async function withRepoSerialization<T>(
  cwd: string | undefined,
  run: () => Promise<T>,
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
    () => gate,
  );
  state.pending += 1;

  let releaseRepoLock:
    | (() => Promise<void>)
    | null = null;
  try {
    await waitForTurn;
    releaseRepoLock = await acquireRepoProcessLock(cwd);
    return await run();
  } finally {
    if (releaseRepoLock) {
      try {
        await releaseRepoLock();
      } catch {
        // Best effort unlock; stale lock eviction
        // handles orphaned locks.
      }
    }
    releaseQueue();
    state.pending -= 1;
    if (state.pending === 0) {
      repoExecQueues.delete(key);
    }
  }
}

// ── Exec helpers ────────────────────────────────────────────

async function execOnce(
  args: string[],
  options?: ExecOptions,
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
      {
        env,
        cwd: options?.cwd,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        const execError = error as (
          NodeJS.ErrnoException & { killed?: boolean }
        ) | null;
        let stderrText = (stderr ?? "").trim();
        if (execError?.killed) {
          const msg =
            `bd command timed out after ${timeoutMs}ms`;
          stderrText = stderrText
            ? `${msg}\n${stderrText}`
            : msg;
        }
        const exitCode =
          execError && typeof execError.code === "number"
            ? execError.code
            : execError ? 1 : 0;
        resolve({
          stdout: (stdout ?? "").trim(),
          stderr: stderrText,
          exitCode,
          timedOut: Boolean(execError?.killed),
        });
      },
    );
  });
}

async function execSerializedAttempt(
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return withRepoSerialization(
    options?.cwd,
    async () => {
      const useNoDb = shouldUseNoDbByDefault(args);
      const firstResult = await execOnce(
        args,
        { ...options, forceNoDb: useNoDb },
      );
      if (firstResult.exitCode === 0) return firstResult;

      // If read-mode DB bypass is explicitly disabled,
      // still recover from the embedded Dolt nil-pointer
      // panic by retrying once in JSONL mode.
      if (
        !useNoDb &&
        isReadOnlyCommand(args) &&
        isEmbeddedDoltPanic(firstResult)
      ) {
        return execOnce(
          args,
          { ...options, forceNoDb: true },
        );
      }

      if (
        args[0] === "sync" ||
        !isOutOfSyncError(firstResult)
      ) {
        return firstResult;
      }

      // Auto-heal stale bd SQLite metadata after repo
      // switches/pulls by importing JSONL and retrying
      // the original command once in the same repo.
      const syncResult = await execOnce(
        ["sync", "--import-only"],
        options,
      );
      if (syncResult.exitCode !== 0) return firstResult;
      return execOnce(args, options);
    },
  );
}

export async function exec(
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  const maxAttempts = canRetryAfterTimeout(args)
    ? 1 + MAX_TIMEOUT_RETRIES
    : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result: ExecResult;
    try {
      result = await execSerializedAttempt(args, options);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Failed to run bd command";
      result = {
        stdout: "",
        stderr: message,
        exitCode: 1,
        timedOut: isLockWaitTimeoutMessage(message),
      };
    }

    if (result.exitCode === 0) return result;

    const shouldRetry =
      attempt < maxAttempts && isTimeoutFailure(result);
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

export async function execWithNoDaemonFallback(
  args: string[],
  options?: { cwd?: string },
): Promise<ExecResult> {
  const firstResult = await exec(args, options);
  if (firstResult.exitCode === 0) return firstResult;
  if (
    !args.includes(NO_DAEMON_FLAG) ||
    !isUnknownNoDaemonFlagError(firstResult)
  ) {
    return firstResult;
  }
  return exec(stripNoDaemonFlag(args), options);
}

export function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export { NO_DAEMON_FLAG };
