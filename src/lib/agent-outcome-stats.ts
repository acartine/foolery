import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export function resolveStatsDir(baseDir = process.cwd()): string {
  return join(baseDir, ".foolery-logs");
}

export function resolveStatsPath(baseDir = process.cwd()): string {
  return join(resolveStatsDir(baseDir), "agent-success-rates.json");
}

// ── Read / Write ───────────────────────────────────────────────

export async function readOutcomeStats(baseDir = process.cwd()): Promise<AgentOutcomeRecord[]> {
  try {
    const raw = await readFile(resolveStatsPath(baseDir), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as AgentOutcomeRecord[];
    return [];
  } catch {
    return [];
  }
}

export async function appendOutcomeRecord(
  record: AgentOutcomeRecord,
  baseDir = process.cwd(),
): Promise<void> {
  const dir = resolveStatsDir(baseDir);
  await mkdir(dir, { recursive: true });
  const existing = await readOutcomeStats(baseDir);
  existing.push(record);
  await writeFile(resolveStatsPath(baseDir), JSON.stringify(existing, null, 2) + "\n");
}
