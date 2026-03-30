import type { AgentDialect } from "@/lib/agent-adapter";
import type { InteractionLog } from "@/lib/interaction-logger";

export interface TokenUsageCounts {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function readCount(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeCodexUsage(
  usage: unknown,
): TokenUsageCounts | null {
  if (!usage || typeof usage !== "object") return null;
  const usageObj = usage as Record<string, unknown>;
  const inputTokens = readCount(usageObj.input_tokens);
  const outputTokens = readCount(usageObj.output_tokens);
  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  const totalTokens =
    readCount(usageObj.total_tokens) ??
    inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function extractTokenUsageFromEvent(
  dialect: AgentDialect,
  parsed: unknown,
): TokenUsageCounts | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (dialect !== "codex" || obj.type !== "turn.completed") {
    return null;
  }
  return normalizeCodexUsage(obj.usage);
}

export function logTokenUsageForEvent(
  interactionLog: InteractionLog,
  dialect: AgentDialect,
  parsed: unknown,
  beatIds: string[],
): void {
  const usage = extractTokenUsageFromEvent(
    dialect,
    parsed,
  );
  if (!usage) return;
  for (const beatId of beatIds) {
    interactionLog.logTokenUsage({
      beatId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    });
  }
}
