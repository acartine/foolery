import { mkdir, appendFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

/**
 * Interaction logger for agent sessions.
 *
 * Writes JSONL log files keyed by repo, bead, and interaction type.
 *
 * Log directory resolution:
 * - Production (installed binary / `next start`): ~/.config/foolery/logs/
 * - Development (`bun dev` / `next dev`):         .foolery-logs/ in project root
 *
 * File layout:
 *   {logDir}/{repo-slug}/{YYYY-MM-DD}/{session-id}.jsonl
 *
 * Each line is a JSON object with a `kind` discriminator:
 *   - kind:"session_start"  — metadata about the session
 *   - kind:"prompt"         — the prompt sent to the agent
 *   - kind:"response"       — a raw NDJSON line from the agent
 *   - kind:"session_end"    — exit code and final status
 */

export type InteractionType = "take" | "scene" | "direct" | "breakdown";

interface SessionMeta {
  sessionId: string;
  interactionType: InteractionType;
  repoPath: string;
  beadIds: string[];
}

interface LogLine {
  kind: string;
  ts: string;
  sessionId: string;
  [key: string]: unknown;
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

function logRoot(): string {
  if (isDev()) {
    return join(process.cwd(), ".foolery-logs");
  }
  return join(homedir(), ".config", "foolery", "logs");
}

function repoSlug(repoPath: string): string {
  // Use the basename of the repo path as a slug, sanitised for filesystem safety.
  const raw = basename(repoPath) || "unknown";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function sessionDir(meta: SessionMeta): string {
  return join(logRoot(), repoSlug(meta.repoPath), dateStamp());
}

function sessionFile(meta: SessionMeta): string {
  return join(sessionDir(meta), `${meta.sessionId}.jsonl`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeLine(path: string, line: LogLine): Promise<void> {
  const serialized = JSON.stringify(line) + "\n";
  await appendFile(path, serialized, "utf-8");
}

/**
 * A lightweight handle returned when a session begins logging.
 * Callers use `logPrompt`, `logResponse`, and `logEnd` to append entries.
 */
export interface InteractionLog {
  /** Log the prompt sent to the agent. */
  logPrompt(prompt: string): void;
  /** Log a raw NDJSON line received from the agent. */
  logResponse(rawLine: string): void;
  /** Log session completion. */
  logEnd(exitCode: number | null, status: string): void;
}

/**
 * Begin logging for an agent interaction session.
 *
 * Returns an `InteractionLog` handle whose methods are fire-and-forget
 * (they never throw and never block the caller).
 */
export async function startInteractionLog(
  meta: SessionMeta,
): Promise<InteractionLog> {
  const dir = sessionDir(meta);
  const file = sessionFile(meta);

  try {
    await ensureDir(dir);
  } catch (err) {
    console.error(`[interaction-logger] Failed to create log dir ${dir}:`, err);
  }

  const startLine: LogLine = {
    kind: "session_start",
    ts: new Date().toISOString(),
    sessionId: meta.sessionId,
    interactionType: meta.interactionType,
    repoPath: meta.repoPath,
    beadIds: meta.beadIds,
  };

  // Fire-and-forget the initial write; errors are swallowed to avoid
  // impacting the main session flow.
  writeLine(file, startLine).catch((err) => {
    console.error(`[interaction-logger] Failed to write session_start:`, err);
  });

  const write = (line: LogLine) => {
    writeLine(file, line).catch((err) => {
      console.error(`[interaction-logger] Write failed:`, err);
    });
  };

  return {
    logPrompt(prompt: string) {
      write({
        kind: "prompt",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        prompt,
      });
    },

    logResponse(rawLine: string) {
      // Store the raw NDJSON line as-is so the full agent response is preserved.
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        parsed = undefined;
      }

      write({
        kind: "response",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        raw: rawLine,
        ...(parsed !== undefined ? { parsed } : {}),
      });
    },

    logEnd(exitCode: number | null, status: string) {
      write({
        kind: "session_end",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        exitCode,
        status,
      });
    },
  };
}

/** A no-op logger for cases where logging setup fails. */
export function noopInteractionLog(): InteractionLog {
  return {
    logPrompt() {},
    logResponse() {},
    logEnd() {},
  };
}
