import { mkdir, appendFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { cleanupLogs } from "@/lib/log-lifecycle";

/**
 * Interaction logger for agent sessions.
 *
 * Writes JSONL log files keyed by repo, beat, and interaction type.
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
 *   - kind:"beat_state"     — beat state snapshot (before/after prompt)
 *   - kind:"session_end"    — exit code and final status
 */

export type InteractionType = "take" | "scene" | "direct";

interface SessionMeta {
  sessionId: string;
  interactionType: InteractionType;
  repoPath: string;
  beatIds: string[];
  agentName?: string;
  agentProvider?: string;
  agentModel?: string;
  agentVersion?: string;
}

export interface PromptLogMetadata {
  source?: string;
}

export interface LifecycleLogEntry {
  event: string;
  beatId?: string;
  iteration?: number;
  [key: string]: unknown;
}

export type BeatStatePhase = "before_prompt" | "after_prompt" | "rollback";

export interface BeatStateLogEntry {
  beatId: string;
  state: string;
  phase: BeatStatePhase;
  iteration?: number;
  label?: string;
}

export interface TokenUsageLogEntry {
  beatId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
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

export function resolveInteractionLogRoot(): string {
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
  return join(resolveInteractionLogRoot(), repoSlug(meta.repoPath), dateStamp());
}

function sessionFile(meta: SessionMeta): string {
  return join(sessionDir(meta), `${meta.sessionId}.jsonl`);
}

function sessionStdoutFile(meta: SessionMeta): string {
  return join(sessionDir(meta), `${meta.sessionId}.stdout.log`);
}

function sessionStderrFile(meta: SessionMeta): string {
  return join(sessionDir(meta), `${meta.sessionId}.stderr.log`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeLine(path: string, line: LogLine): Promise<void> {
  const serialized = JSON.stringify(line) + "\n";
  await appendFile(path, serialized, "utf-8");
}

function normalizeTokenUsageEntry(
  entry: TokenUsageLogEntry,
): TokenUsageLogEntry | null {
  const beatId = entry.beatId.trim();
  if (!beatId) return null;
  const inputTokens = Math.trunc(entry.inputTokens);
  const outputTokens = Math.trunc(entry.outputTokens);
  const totalTokens = Math.trunc(
    entry.totalTokens ?? inputTokens + outputTokens,
  );
  if (
    [inputTokens, outputTokens, totalTokens].some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    return null;
  }
  return {
    beatId,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

/**
 * A sequential write queue that ensures appends to a single file
 * are serialized, preventing interleaved output from concurrent
 * fire-and-forget calls.
 */
function createWriteQueue(filePath: string): (chunk: string) => void {
  let chain: Promise<void> = Promise.resolve();
  return (chunk: string) => {
    chain = chain
      .then(() => appendFile(filePath, chunk, "utf-8"))
      .catch((err) => {
        console.error(`[interaction-logger] raw write failed (${filePath}):`, err);
      });
  };
}

/**
 * A lightweight handle returned when a session begins logging.
 * Callers use `logPrompt`, `logResponse`, and `logEnd` to append entries.
 */
export interface InteractionLog {
  /** Path to the log file on disk. Empty string for no-op loggers. */
  readonly filePath: string;
  /** Path to the stdout log file. Empty string for no-op loggers. */
  readonly stdoutPath: string;
  /** Path to the stderr log file. Empty string for no-op loggers. */
  readonly stderrPath: string;
  /** Log the prompt sent to the agent. */
  logPrompt(prompt: string, metadata?: PromptLogMetadata): void;
  /** Log a raw NDJSON line received from the agent. */
  logResponse(rawLine: string): void;
  /** Log beat state snapshot before or after a prompt. */
  logBeatState(entry: BeatStateLogEntry): void;
  /** Log beat-scoped token usage for the session agent. */
  logTokenUsage(entry: TokenUsageLogEntry): void;
  /** Log a raw stdout chunk from the agent child process. */
  logStdout(chunk: string): void;
  /** Log a raw stderr chunk from the agent child process. */
  logStderr(chunk: string): void;
  /** Log a structured lifecycle event for prompt/response handoff. */
  logLifecycle?(entry: LifecycleLogEntry): void;
  /** Log session completion. */
  logEnd(exitCode: number | null, status: string): void;
}

function createJsonLogWriter(filePath: string) {
  return (line: LogLine) => {
    writeLine(filePath, line).catch((err) => {
      console.error(`[interaction-logger] Write failed:`, err);
    });
  };
}

function createInteractionLogHandle(
  meta: SessionMeta,
  file: string,
  stdoutFile: string,
  stderrFile: string,
): InteractionLog {
  const write = createJsonLogWriter(file);
  return {
    filePath: file,
    stdoutPath: stdoutFile,
    stderrPath: stderrFile,
    logPrompt(prompt: string, metadata?: PromptLogMetadata) {
      write({
        kind: "prompt",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        prompt,
        ...(metadata?.source ? { source: metadata.source } : {}),
      });
    },

    logResponse(rawLine: string) {
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

    logBeatState(entry: BeatStateLogEntry) {
      write({
        kind: "beat_state",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        beatId: entry.beatId,
        state: entry.state,
        phase: entry.phase,
        ...(entry.iteration !== undefined ? { iteration: entry.iteration } : {}),
        ...(entry.label ? { label: entry.label } : {}),
      });
    },

    logTokenUsage(entry: TokenUsageLogEntry) {
      const normalized = normalizeTokenUsageEntry(entry);
      if (!normalized) return;
      write({
        kind: "token_usage",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        beatId: normalized.beatId,
        inputTokens: normalized.inputTokens,
        outputTokens: normalized.outputTokens,
        totalTokens: normalized.totalTokens,
        ...(meta.agentName ? { agentName: meta.agentName } : {}),
        ...(meta.agentProvider
          ? { agentProvider: meta.agentProvider }
          : {}),
        ...(meta.agentModel ? { agentModel: meta.agentModel } : {}),
        ...(meta.agentVersion ? { agentVersion: meta.agentVersion } : {}),
      });
    },

    logStdout: createWriteQueue(stdoutFile),
    logStderr: createWriteQueue(stderrFile),
    logLifecycle(entry: LifecycleLogEntry) {
      write({
        kind: "lifecycle",
        ts: new Date().toISOString(),
        sessionId: meta.sessionId,
        ...entry,
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

/**
 * Throttle cleanup to run at most once per hour per process.
 * Covers long-running dev servers where a single startup pass is insufficient.
 *
 * Note: The throttle is process-local. In multi-worker deployments each worker
 * may run its own cleanup pass on startup. This is acceptable because cleanup
 * is idempotent and typically completes in <100ms for normal log volumes.
 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let lastCleanupMs = 0;

function maybeScheduleCleanup(): void {
  const now = Date.now();
  if (now - lastCleanupMs < CLEANUP_INTERVAL_MS) return;
  lastCleanupMs = now;
  // Fire-and-forget: never blocks session logging, errors are swallowed.
  cleanupLogs().catch((err) => {
    console.error("[interaction-logger] Log cleanup failed:", err);
  });
}

/**
 * Begin logging for an agent interaction session.
 *
 * Triggers a fire-and-forget log cleanup pass (at most once per hour)
 * to compress old files, delete expired files, and enforce size cap.
 *
 * Returns an `InteractionLog` handle whose methods are fire-and-forget
 * (they never throw and never block the caller).
 */
export async function startInteractionLog(
  meta: SessionMeta,
): Promise<InteractionLog> {
  const dir = sessionDir(meta);
  const file = sessionFile(meta);
  const stdoutFile = sessionStdoutFile(meta);
  const stderrFile = sessionStderrFile(meta);

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
    beatIds: meta.beatIds,
    ...(meta.agentName ? { agentName: meta.agentName } : {}),
    ...(meta.agentProvider
      ? { agentProvider: meta.agentProvider }
      : {}),
    ...(meta.agentModel ? { agentModel: meta.agentModel } : {}),
    ...(meta.agentVersion ? { agentVersion: meta.agentVersion } : {}),
  };
  try {
    await writeLine(file, startLine);
  } catch (err) {
    console.error(`[interaction-logger] Failed to write session_start:`, err);
  }
  maybeScheduleCleanup();
  return createInteractionLogHandle(
    meta,
    file,
    stdoutFile,
    stderrFile,
  );
}

/** A no-op logger for cases where logging setup fails. */
export function noopInteractionLog(): InteractionLog {
  return {
    filePath: "",
    stdoutPath: "",
    stderrPath: "",
    logPrompt() {},
    logResponse() {},
    logBeatState() {},
    logTokenUsage() {},
    logStdout() {},
    logStderr() {},
    logLifecycle() {},
    logEnd() {},
  };
}
