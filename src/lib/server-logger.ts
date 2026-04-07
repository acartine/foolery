import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveInteractionLogRoot } from "@/lib/interaction-logger";
import type { ClientPerfEvent } from "@/lib/perf-events";

/**
 * Server-side disk logger for API errors and CLI failures.
 *
 * Writes JSONL to {logRoot}/_server/{YYYY-MM-DD}/server.jsonl.
 * The `_server` synthetic repo slug lets log-lifecycle.ts handle
 * compression/deletion/size-cap with zero changes.
 *
 * All writes are fire-and-forget: they never throw and never block callers.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

interface ApiErrorInput {
  method: string;
  path: string;
  status: number;
  error: string | undefined;
}

interface CliFailureInput {
  command: string;
  args: string[];
  exitCode: number;
  stderr: string;
}

export const SERVER_SLUG = "_server";

export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resolveServerLogDir(date = dateStamp()): string {
  return join(resolveInteractionLogRoot(), SERVER_SLUG, date);
}

/**
 * Sequential write queue that serialises mkdir + append to a single
 * promise chain, preventing interleaved output and ensuring directory
 * creation completes before the first write.
 */
function createWriteQueue(): {
  enqueue: (dir: string, filePath: string, line: string) => void;
} {
  let chain: Promise<void> = Promise.resolve();
  const ensuredDirs = new Set<string>();
  return {
    enqueue(dir: string, filePath: string, line: string) {
      chain = chain
        .then(async () => {
          if (!ensuredDirs.has(dir)) {
            await mkdir(dir, { recursive: true });
            ensuredDirs.add(dir);
          }
          await appendFile(filePath, line, "utf-8");
        })
        .catch((err) => {
          if (
            process.env.VITEST
            && err instanceof Error
            && err.message.includes(
              'No "appendFile" export is defined on the "node:fs/promises" mock',
            )
          ) {
            return;
          }
          console.error(`[server-logger] write failed (${filePath}):`, err);
        });
    },
  };
}

const queue = createWriteQueue();

/**
 * Write a structured log entry to the server log file.
 * Fire-and-forget — never throws, falls back to console.error.
 */
export function serverLog(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    const date = dateStamp();
    const dir = resolveServerLogDir(date);
    const filePath = join(dir, "server.jsonl");
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      category,
      message,
      ...(data ? { data } : {}),
    };
    const line = JSON.stringify(entry) + "\n";
    queue.enqueue(dir, filePath, line);
  } catch (err) {
    console.error("[server-logger] unexpected error:", err);
  }
}

/** Convenience wrapper for API error logging. */
export function logApiError({ method, path, status, error }: ApiErrorInput): void {
  serverLog("error", "api", `${method} ${path} → ${status}`, {
    method,
    path,
    status,
    error: error ?? "unknown",
  });
}

/** Convenience wrapper for CLI failure logging. */
export function logCliFailure({ command, args, exitCode, stderr }: CliFailureInput): void {
  const cmdLabel = [command, ...args.slice(0, 5)].join(" ");
  serverLog("error", "cli", `${cmdLabel} exited ${exitCode}`, {
    command,
    args,
    exitCode,
    stderr,
  });
}

export function logClientPerfEvent(event: ClientPerfEvent): void {
  serverLog("info", "client-perf", event.kind, {
    event,
  });
}
