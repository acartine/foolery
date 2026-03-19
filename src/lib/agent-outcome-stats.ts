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

export function resolveStatsDir(): string {
  return join(process.cwd(), ".foolery-logs");
}

export function resolveStatsPath(): string {
  return join(resolveStatsDir(), "agent-success-rates.jsonl");
}

function resolveLegacyStatsPath(): string {
  return join(resolveStatsDir(), "agent-success-rates.json");
}

// ── Read / Write ───────────────────────────────────────────────

export async function readOutcomeStats(): Promise<AgentOutcomeRecord[]> {
  try {
    const raw = await readFile(resolveStatsPath(), "utf-8");
    const trimmed = raw.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as AgentOutcomeRecord[];
      return [];
    }

    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AgentOutcomeRecord);
  } catch {
    try {
      const raw = await readFile(resolveLegacyStatsPath(), "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AgentOutcomeRecord[];
      return [];
    } catch {
      return [];
    }
  }
}

export async function appendOutcomeRecord(record: AgentOutcomeRecord): Promise<void> {
  await mkdir(resolveStatsDir(), { recursive: true });
  await appendFile(resolveStatsPath(), `${JSON.stringify(record)}\n`, "utf-8");
}
