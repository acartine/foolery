import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { RegisteredRepo } from "@/lib/registry";
import { serverLog } from "@/lib/server-logger";

const execFile = promisify(execFileCallback);

export interface BeatsSyncRunResult {
  ok: boolean;
  error?: string;
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
  const run = deps.execFile ?? execFile;
  try {
    await run(file, args, { cwd: repo.path });
    return { ok: true };
  } catch (error) {
    const message = formatError(error);
    serverLog("warn", "beats-sync", "repo sync failed", {
      repoPath: repo.path,
      memoryManagerType: repo.memoryManagerType,
      command: [file, ...args].join(" "),
      error: message,
    });
    return { ok: false, error: message };
  }
}
