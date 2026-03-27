import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { constants as fsConstants } from "node:fs";
import type { NextRequest } from "next/server";
import type { AppUpdateStatus } from "@/lib/app-update-types";

export const VERSION_UPDATE_COMMAND =
  "foolery update && foolery restart";

const TERMINAL_STATUS_TTL_MS = 15 * 60_000;
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

type UpdatePaths = {
  launcherPath: string;
  statusPath: string;
  logPath: string;
};

type StartAppUpdateResult = {
  status: AppUpdateStatus;
  started: boolean;
};

function resolvePaths(env: NodeJS.ProcessEnv = process.env): UpdatePaths {
  const stateDir =
    env.FOOLERY_STATE_DIR ??
    join(homedir(), ".local", "state", "foolery");
  const launcherPath =
    env.FOOLERY_LAUNCHER_PATH ??
    join(homedir(), ".local", "bin", "foolery");
  const statusPath =
    env.FOOLERY_UPDATE_STATUS_PATH ??
    join(stateDir, "app-update-status.json");
  const logPath =
    env.FOOLERY_UPDATE_LOG_PATH ??
    join(stateDir, "app-update.log");

  return { launcherPath, statusPath, logPath };
}

function idleStatus(
  fallbackCommand = VERSION_UPDATE_COMMAND,
): AppUpdateStatus {
  return {
    phase: "idle",
    message: null,
    error: null,
    startedAt: null,
    endedAt: null,
    workerPid: null,
    launcherPath: null,
    fallbackCommand,
  };
}

function isInProgress(phase: AppUpdateStatus["phase"]): boolean {
  return (
    phase === "starting" ||
    phase === "updating" ||
    phase === "restarting"
  );
}

function isTerminal(phase: AppUpdateStatus["phase"]): boolean {
  return phase === "completed" || phase === "failed";
}

function normalizeStatus(
  status: AppUpdateStatus,
  now = Date.now(),
): AppUpdateStatus {
  if (
    isTerminal(status.phase) &&
    status.endedAt !== null &&
    now - status.endedAt > TERMINAL_STATUS_TTL_MS
  ) {
    return idleStatus(status.fallbackCommand);
  }

  if (
    isInProgress(status.phase) &&
    status.workerPid !== null
  ) {
    try {
      process.kill(status.workerPid, 0);
    } catch {
      return {
        ...status,
        phase: "failed",
        endedAt: now,
        error:
          status.error ??
          "Update worker exited before completion.",
        message: "Automatic update failed",
      };
    }
  }

  return status;
}

async function writeStatusFile(
  status: AppUpdateStatus,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { statusPath } = resolvePaths(env);
  await mkdir(dirname(statusPath), { recursive: true });
  await writeFile(
    statusPath,
    JSON.stringify(status),
    "utf8",
  );
}

export async function readAppUpdateStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppUpdateStatus> {
  const { statusPath } = resolvePaths(env);
  try {
    const raw = await readFile(statusPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppUpdateStatus>;
    return normalizeStatus({
      ...idleStatus(),
      ...parsed,
    });
  } catch {
    return idleStatus();
  }
}

async function ensureLauncherExecutable(
  launcherPath: string,
): Promise<void> {
  await access(launcherPath, fsConstants.X_OK);
}

function buildWorkerSource(): string {
  return [
    'const { execFile } = require("node:child_process");',
    'const { appendFile, mkdir, writeFile } = require("node:fs/promises");',
    'const { dirname } = require("node:path");',
    'const { promisify } = require("node:util");',
    "const execFileAsync = promisify(execFile);",
    "const launcherPath = process.env.FOOLERY_LAUNCHER_PATH;",
    "const statusPath = process.env.FOOLERY_UPDATE_STATUS_PATH;",
    "const logPath = process.env.FOOLERY_UPDATE_LOG_PATH;",
    "const fallbackCommand = process.env.FOOLERY_UPDATE_FALLBACK_COMMAND;",
    "const startedAt = Date.now();",
    "async function ensureDirs() {",
    "  await mkdir(dirname(statusPath), { recursive: true });",
    "  await mkdir(dirname(logPath), { recursive: true });",
    "}",
    "async function appendLog(line) {",
    "  await ensureDirs();",
    '  const entry = `[${new Date().toISOString()}] ${line}\\n`;',
    '  await appendFile(logPath, entry, "utf8");',
    "}",
    "async function writeStatus(patch) {",
    "  await ensureDirs();",
    "  const payload = {",
    "    phase: patch.phase,",
    "    message: patch.message ?? null,",
    "    error: patch.error ?? null,",
    "    startedAt,",
    "    endedAt: patch.endedAt ?? null,",
    "    workerPid: process.pid,",
    "    launcherPath,",
    "    fallbackCommand,",
    "  };",
    '  await writeFile(statusPath, JSON.stringify(payload), "utf8");',
    "}",
    "async function runLauncher(command) {",
    "  const result = await execFileAsync(",
    "    launcherPath,",
    "    [command],",
    "    { maxBuffer: 10 * 1024 * 1024 },",
    "  );",
    "  if (result.stdout) {",
    "    await appendLog(result.stdout.trim());",
    "  }",
    "  if (result.stderr) {",
    "    await appendLog(result.stderr.trim());",
    "  }",
    "}",
    "(async () => {",
    "  try {",
    "    await writeStatus({",
    '      phase: "updating",',
    '      message: "Downloading and installing update",',
    "    });",
    '    await appendLog("Running launcher update");',
    '    await runLauncher("update");',
    "    await writeStatus({",
    '      phase: "restarting",',
    '      message: "Restarting Foolery",',
    "    });",
    '    await appendLog("Running launcher restart");',
    '    await runLauncher("restart");',
    "    await writeStatus({",
    '      phase: "completed",',
    '      message: "Update completed",',
    "      endedAt: Date.now(),",
    "    });",
    "  } catch (error) {",
    "    const message =",
    '      error instanceof Error ? error.message : "Unknown error";',
    "    await appendLog(`Update failed: ${message}`);",
    "    await writeStatus({",
    '      phase: "failed",',
    '      message: "Automatic update failed",',
    "      error: message,",
    "      endedAt: Date.now(),",
    "    });",
    "    process.exitCode = 1;",
    "  }",
    "})();",
  ].join("\n");
}

export async function startAppUpdate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StartAppUpdateResult> {
  const paths = resolvePaths(env);
  await ensureLauncherExecutable(paths.launcherPath);

  const existing = await readAppUpdateStatus(env);
  if (isInProgress(existing.phase)) {
    return { status: existing, started: false };
  }

  const initialStatus: AppUpdateStatus = {
    phase: "starting",
    message: "Launching update worker",
    error: null,
    startedAt: Date.now(),
    endedAt: null,
    workerPid: null,
    launcherPath: paths.launcherPath,
    fallbackCommand: VERSION_UPDATE_COMMAND,
  };
  await writeStatusFile(initialStatus, env);

  const child = spawn(
    process.execPath,
    ["-e", buildWorkerSource()],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...env,
        FOOLERY_LAUNCHER_PATH: paths.launcherPath,
        FOOLERY_UPDATE_STATUS_PATH: paths.statusPath,
        FOOLERY_UPDATE_LOG_PATH: paths.logPath,
        FOOLERY_UPDATE_FALLBACK_COMMAND:
          VERSION_UPDATE_COMMAND,
      },
    },
  );
  child.unref();

  const queuedStatus: AppUpdateStatus = {
    ...initialStatus,
    phase: "updating",
    message: "Downloading and installing update",
    workerPid: child.pid ?? null,
  };
  await writeStatusFile(queuedStatus, env);
  return { status: queuedStatus, started: true };
}

export function isAllowedLocalUpdateRequest(
  request: NextRequest,
): boolean {
  if (!LOCAL_HOSTS.has(request.nextUrl.hostname)) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (
      LOCAL_HOSTS.has(parsed.hostname) &&
      parsed.origin === request.nextUrl.origin
    );
  } catch {
    return false;
  }
}
