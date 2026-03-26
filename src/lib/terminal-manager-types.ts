import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { InteractionLog } from "@/lib/interaction-logger";
import type { TerminalSession, TerminalEvent } from "@/lib/types";

export interface SessionEntry {
  session: TerminalSession;
  process: ChildProcess | null;
  abort?: () => void;
  releaseKnotsLease?: (
    reason: string,
    outcome?: "success" | "warning" | "error",
    data?: Record<string, unknown>,
  ) => void;
  emitter: EventEmitter;
  buffer: TerminalEvent[];
  interactionLog: InteractionLog;
  knotsLeaseId?: string;
}

export const INPUT_CLOSE_GRACE_MS = 2000;

/**
 * Resolve a CLI command that may not be on PATH.
 * Checks common locations (bun global bin).
 * Returns the original command if no alternative found.
 */
export function resolveAgentCommand(
  command: string,
): string {
  if (command.includes("/")) return command;
  const bunBin = join(
    homedir(),
    ".bun",
    "bin",
    command,
  );
  if (existsSync(bunBin)) return bunBin;
  return command;
}
