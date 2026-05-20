import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { RegisteredRepo } from "@/lib/registry";
import { serverLog } from "@/lib/server-logger";

const execFile = promisify(execFileCallback);

export interface BeatsSyncRunResult {
  ok: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  command: string;
}

export interface BeatsSyncRunnerDeps {
  execFile?: (
    file: string,
    args: string[],
    options: { cwd: string },
  ) => Promise<{ stdout?: string; stderr?: string }>;
}

function commandFor(repo: RegisteredRepo): { file: string; args: string[] } {
  if (repo.memoryManagerType === "knots") return { file: "kno", args: ["sync"] };
  return { file: "bd", args: ["sync", "--no-daemon"] };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function runRepoSync(
  repo: RegisteredRepo,
  deps: BeatsSyncRunnerDeps = {},
): Promise<BeatsSyncRunResult> {
  const { file, args } = commandFor(repo);
  const command = [file, ...args].join(" ");
  const run = deps.execFile ?? execFile;
  try {
    const result = await run(file, args, { cwd: repo.path });
    return {
      ok: true,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const message = formatError(error);
    serverLog("warn", "beats-sync", "repo sync failed", {
      repoPath: repo.path,
      memoryManagerType: repo.memoryManagerType,
      command,
      error: message,
    });
    return {
      ok: false,
      command,
      error: message,
      stdout: errorOutput(error, "stdout"),
      stderr: errorOutput(error, "stderr"),
    };
  }
}

function errorOutput(error: unknown, key: "stdout" | "stderr"): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
