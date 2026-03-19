import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────

export interface AgentOutcomeRecord {
  /** ISO-8601 timestamp of when this iteration completed. */
  timestamp: string;
  /** The beat being worked on. */
  beatId: string;
  /** Session identifier for the terminal-manager session. */
  sessionId: string;
  /** 1-based iteration number within the take-loop. */
  iteration: number;
  /** Identity of the agent that ran this iteration. */
  agent: {
    agentId?: string;
    label?: string;
    model?: string;
    version?: string;
    command: string;
  };
  /** The workflow step's queue state observed before dispatch. */
  claimedState: string;
  /** The workflow step name (e.g., "implementation"). */
  claimedStep?: string;
  /** The child process exit code. */
  exitCode: number;
  /** The beat state observed after the child exited. */
  postExitState: string;
  /** Whether the beat was rolled back after exit. */
  rolledBack: boolean;
  /** Whether an alternative agent was available for retry. */
  alternativeAgentAvailable: boolean;
  /** Computed success classification. */
  success: boolean;
}

// ── Stats file resolution ──────────────────────────────────────

export function resolveStatsDir(baseDir?: string): string {
  return join(baseDir ?? process.cwd(), ".foolery-logs");
}

export function resolveStatsPath(baseDir?: string): string {
  return join(resolveStatsDir(baseDir), "agent-success-rates.jsonl");
}

// ── Read / Write ───────────────────────────────────────────────

/**
 * Read all outcome records from the JSONL stats file.
 * Each line is an independent JSON object, so concurrent appends
 * from different sessions cannot corrupt each other's data.
 */
export async function readOutcomeStats(baseDir?: string): Promise<AgentOutcomeRecord[]> {
  try {
    const raw = await readFile(resolveStatsPath(baseDir), "utf-8");
    const records: AgentOutcomeRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as AgentOutcomeRecord);
      } catch {
        // Skip malformed lines (e.g. partial writes from a crash)
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Append a single outcome record as a JSONL line.
 * Uses appendFile which is safe under concurrent sessions —
 * small appends (< PIPE_BUF, typically 4096 bytes) are atomic on POSIX.
 */
export async function appendOutcomeRecord(
  record: AgentOutcomeRecord,
  baseDir?: string,
): Promise<void> {
  const dir = resolveStatsDir(baseDir);
  await mkdir(dir, { recursive: true });
  await appendFile(resolveStatsPath(baseDir), JSON.stringify(record) + "\n");
}
