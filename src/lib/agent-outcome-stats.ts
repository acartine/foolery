import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────

export type AgentOutcomeClassification =
  | "advanced_to_next_queue"
  | "returned_to_prior_queue"
  | "non_zero_exit"
  | "same_claimed_queue"
  | "moved_to_terminal"
  | "left_in_action_state"
  | "unknown_transition"
  | "unresolved_claimed_state";

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
  /** Canonical key used for per-agent success summaries. */
  agentType: string;
  /** The child process exit code. */
  exitCode: number;
  /** The beat state observed after the child exited. */
  postExitState: string;
  /** Whether the beat was rolled back after exit. */
  rolledBack: boolean;
  /** Whether an alternative agent was available for retry. */
  alternativeAgentAvailable: boolean;
  /** How this outcome was classified. */
  outcome: AgentOutcomeClassification;
  /** Computed success classification. */
  success: boolean;
}

export interface AgentSuccessSummary {
  agentType: string;
  label: string;
  command: string;
  model?: string;
  version?: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  lastRecordedAt: string;
}

export interface AgentOutcomeStatsReport {
  version: 1;
  generatedAt: string;
  records: AgentOutcomeRecord[];
  summaries: AgentSuccessSummary[];
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
    if (parsed && Array.isArray(parsed.records)) return parsed.records as AgentOutcomeRecord[];
    return [];
  } catch {
    return [];
  }
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function buildAgentType(record: AgentOutcomeRecord): string {
  const existing = typeof record.agentType === "string" ? record.agentType.trim() : "";
  if (existing) return existing;
  const command = record.agent.command?.trim() || "unknown";
  const model = record.agent.model?.trim();
  return model ? `${command}:${model}` : command;
}

function buildLabel(record: AgentOutcomeRecord): string {
  return record.agent.label?.trim() || record.agent.command?.trim() || buildAgentType(record);
}

export function summarizeOutcomeStats(records: AgentOutcomeRecord[]): AgentSuccessSummary[] {
  const grouped = new Map<string, AgentSuccessSummary>();

  for (const record of records) {
    const agentType = buildAgentType(record);
    const current = grouped.get(agentType);
    if (current) {
      current.attempts += 1;
      current.successes += record.success ? 1 : 0;
      current.failures += record.success ? 0 : 1;
      current.lastRecordedAt = record.timestamp > current.lastRecordedAt
        ? record.timestamp
        : current.lastRecordedAt;
      current.successRate = roundRate(current.successes / current.attempts);
      continue;
    }

    grouped.set(agentType, {
      agentType,
      label: buildLabel(record),
      command: record.agent.command,
      ...(record.agent.model ? { model: record.agent.model } : {}),
      ...(record.agent.version ? { version: record.agent.version } : {}),
      attempts: 1,
      successes: record.success ? 1 : 0,
      failures: record.success ? 0 : 1,
      successRate: roundRate(record.success ? 1 : 0),
      lastRecordedAt: record.timestamp,
    });
  }

  return Array.from(grouped.values()).sort((left, right) => left.agentType.localeCompare(right.agentType));
}

export async function readOutcomeStatsReport(baseDir = process.cwd()): Promise<AgentOutcomeStatsReport> {
  const records = await readOutcomeStats(baseDir);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    records,
    summaries: summarizeOutcomeStats(records),
  };
}

export async function appendOutcomeRecord(
  record: AgentOutcomeRecord,
  baseDir = process.cwd(),
): Promise<void> {
  const dir = resolveStatsDir(baseDir);
  await mkdir(dir, { recursive: true });
  const existing = await readOutcomeStats(baseDir);
  const nextRecord: AgentOutcomeRecord = {
    ...record,
    agentType: buildAgentType(record),
  };
  const records = [...existing, nextRecord];
  const report: AgentOutcomeStatsReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    records,
    summaries: summarizeOutcomeStats(records),
  };
  await writeFile(resolveStatsPath(baseDir), JSON.stringify(report, null, 2) + "\n");
}
