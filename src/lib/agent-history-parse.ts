/**
 * JSONL session parsing for agent-history.
 *
 * Extracted from agent-history.ts to stay under 500 lines
 * and keep parseSession under 100 lines.
 */
import { naturalCompare } from "@/lib/beat-sort";
import type {
  AgentHistoryBeatTokenUsage,
  AgentHistoryEntry,
  AgentHistoryInteractionType,
} from "@/lib/agent-history-types";
import type { AgentHistoryQuery } from "@/lib/agent-history-resolve";

const MAX_LINE_CHARS = 120_000;

export interface SessionStartLine {
  sessionId: string;
  interactionType: AgentHistoryInteractionType;
  repoPath: string;
  beatIds: string[];
  ts: string;
  agentName?: string;
  agentModel?: string;
  agentVersion?: string;
}

export interface SessionParseResult {
  start: SessionStartLine;
  updatedAt: string;
  endedAt?: string;
  status?: string;
  exitCode?: number | null;
  entries: AgentHistoryEntry[];
  tokenUsage: Array<{
    beatId: string;
    usage: AgentHistoryBeatTokenUsage;
  }>;
  titleHints: Map<string, string>;
  workflowStates: string[];
}

// ── Small helpers ────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseMillis(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function newerTimestamp(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return parseMillis(b) > parseMillis(a) ? b : a;
}

function clipText(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  const extra = text.length - MAX_LINE_CHARS;
  return (
    `${text.slice(0, MAX_LINE_CHARS)}` +
    `\n... [truncated ${extra} chars]`
  );
}

function extractBeatTitles(
  prompt: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const pairRegex =
    /(?:^|\n)(?:Parent ID|ID):\s*([^\n]+)\n(?:Parent Title|Title):\s*([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(prompt)) !== null) {
    const beatId = match[1]?.trim();
    const title = match[2]?.trim();
    if (!beatId || !title) continue;
    result.set(beatId, title);
  }
  return result;
}

// ── Session start parsing ────────────────────────────────────

function parseSessionStart(
  parsed: Record<string, unknown>,
  sessionId: string,
  ts: string,
): SessionStartLine | null {
  const rawType = parsed.interactionType;
  if (
    rawType !== "take" &&
    rawType !== "scene" &&
    rawType !== "direct"
  ) {
    return null;
  }

  const repoPath =
    typeof parsed.repoPath === "string"
      ? parsed.repoPath
      : "";
  if (!repoPath) return null;

  const rawBeatIds = Array.isArray(parsed.beatIds)
    ? parsed.beatIds
    : [];
  const beatIds = rawBeatIds
    .filter(isNonEmptyString)
    .map((v) => v.trim());
  if (beatIds.length === 0) return null;

  return {
    sessionId: sessionId || "unknown",
    interactionType: rawType,
    repoPath,
    beatIds,
    ts: ts || new Date(0).toISOString(),
    agentName:
      typeof parsed.agentName === "string"
        ? parsed.agentName
        : undefined,
    agentModel:
      typeof parsed.agentModel === "string"
        ? parsed.agentModel
        : undefined,
    agentVersion:
      typeof parsed.agentVersion === "string"
        ? parsed.agentVersion
        : undefined,
  };
}

// ── Line-level handlers ──────────────────────────────────────

interface ParseContext {
  start: SessionStartLine;
  capturesEntries: boolean;
  entries: AgentHistoryEntry[];
  tokenUsage: Array<{
    beatId: string;
    usage: AgentHistoryBeatTokenUsage;
  }>;
  titleHints: Map<string, string>;
  workflowStates: Set<string>;
  promptCounter: number;
  pendingPromptState?: string;
  pendingPromptNumber?: number;
  updatedAt: string;
  endedAt?: string;
  status?: string;
  exitCode?: number | null;
}

function parseTokenUsageLine(
  parsed: Record<string, unknown>,
): { beatId: string; usage: AgentHistoryBeatTokenUsage } | null {
  const beatId =
    typeof parsed.beatId === "string"
      ? parsed.beatId.trim()
      : "";
  const agentLabel =
    typeof parsed.agentName === "string"
      ? parsed.agentName.trim()
      : "";
  const counts = [
    parsed.inputTokens,
    parsed.outputTokens,
    parsed.totalTokens,
  ].map((value) => (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
      ? Math.trunc(value)
      : null
  ));
  if (
    !beatId ||
    !agentLabel ||
    counts[0] === null ||
    counts[1] === null ||
    counts[2] === null
  ) {
    return null;
  }
  return {
    beatId,
    usage: {
      agentLabel,
      agentModel:
        typeof parsed.agentModel === "string"
          ? parsed.agentModel
          : undefined,
      agentVersion:
        typeof parsed.agentVersion === "string"
          ? parsed.agentVersion
          : undefined,
      inputTokens: counts[0],
      outputTokens: counts[1],
      totalTokens: counts[2],
    },
  };
}

function handlePromptLine(
  ctx: ParseContext,
  parsed: Record<string, unknown>,
  ts: string,
  lineIndex: number,
): void {
  ctx.promptCounter += 1;
  const prompt =
    typeof parsed.prompt === "string" ? parsed.prompt : "";
  if (prompt) {
    const hints = extractBeatTitles(prompt);
    for (const [beatId, title] of hints.entries()) {
      if (!ctx.start.beatIds.includes(beatId)) continue;
      if (!ctx.titleHints.has(beatId)) {
        ctx.titleHints.set(beatId, title);
      }
    }
  }
  if (!ctx.capturesEntries || !prompt) return;
  const promptSource =
    typeof parsed.source === "string"
      ? parsed.source
      : undefined;
  const promptNumber =
    typeof ctx.pendingPromptNumber === "number" &&
    ctx.pendingPromptNumber > 0
      ? ctx.pendingPromptNumber
      : ctx.promptCounter;
  ctx.entries.push({
    id: `${ctx.start.sessionId}:prompt:${lineIndex}`,
    kind: "prompt",
    ts: ts || ctx.start.ts,
    prompt: clipText(prompt),
    ...(promptSource ? { promptSource } : {}),
    promptNumber,
    ...(ctx.pendingPromptState
      ? { workflowState: ctx.pendingPromptState }
      : {}),
  });
  ctx.pendingPromptNumber = undefined;
}

function handleResponseLine(
  ctx: ParseContext,
  parsed: Record<string, unknown>,
  ts: string,
  lineIndex: number,
): void {
  if (!ctx.capturesEntries) return;
  const raw =
    typeof parsed.raw === "string"
      ? parsed.raw
      : parsed.parsed !== undefined
        ? JSON.stringify(parsed.parsed)
        : JSON.stringify(parsed);
  ctx.entries.push({
    id: `${ctx.start.sessionId}:response:${lineIndex}`,
    kind: "response",
    ts: ts || ctx.start.ts,
    raw: clipText(raw),
  });
}

function handleBeatStateLine(
  ctx: ParseContext,
  parsed: Record<string, unknown>,
): void {
  if (!ctx.capturesEntries) return;
  const state =
    typeof parsed.state === "string"
      ? parsed.state.trim()
      : "";
  if (state) ctx.workflowStates.add(state);
  const phase =
    typeof parsed.phase === "string"
      ? parsed.phase.trim()
      : "";
  const iteration =
    typeof parsed.iteration === "number" &&
    Number.isInteger(parsed.iteration) &&
    parsed.iteration > 0
      ? parsed.iteration
      : undefined;
  if (phase === "before_prompt") {
    if (state) ctx.pendingPromptState = state;
    if (iteration !== undefined) {
      ctx.pendingPromptNumber = iteration;
    }
  }
}

function handleSessionEndLine(
  ctx: ParseContext,
  parsed: Record<string, unknown>,
  ts: string,
  lineIndex: number,
): void {
  ctx.endedAt = ts || ctx.endedAt;
  ctx.status =
    typeof parsed.status === "string"
      ? parsed.status
      : ctx.status;
  if (
    typeof parsed.exitCode === "number" ||
    parsed.exitCode === null
  ) {
    ctx.exitCode = parsed.exitCode;
  }
  if (!ctx.capturesEntries) return;
  ctx.entries.push({
    id: `${ctx.start.sessionId}:session_end:${lineIndex}`,
    kind: "session_end",
    ts: ts || ctx.start.ts,
    ...(ctx.status ? { status: ctx.status } : {}),
    ...(ctx.exitCode !== undefined
      ? { exitCode: ctx.exitCode }
      : {}),
  });
}

// ── parseSession ─────────────────────────────────────────────

export function parseSession(
  content: string,
  query: AgentHistoryQuery,
): SessionParseResult | null {
  const lines = content.split("\n");
  const ctx: Partial<ParseContext> = {
    entries: [],
    tokenUsage: [],
    titleHints: new Map(),
    workflowStates: new Set(),
    promptCounter: 0,
    updatedAt: "",
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const kind =
      typeof parsed.kind === "string" ? parsed.kind : "";
    const sessionId =
      typeof parsed.sessionId === "string"
        ? parsed.sessionId
        : "";
    const ts =
      typeof parsed.ts === "string" ? parsed.ts : "";

    if (kind === "session_start") {
      const start = parseSessionStart(
        parsed,
        sessionId,
        ts,
      );
      if (!start) return null;
      ctx.start = start;
      ctx.updatedAt = newerTimestamp(ctx.updatedAt!, start.ts);
      ctx.capturesEntries = Boolean(
        query.beatId && start.beatIds.includes(query.beatId),
      );
      if (ctx.capturesEntries) {
        ctx.entries!.push({
          id: `${start.sessionId}:session_start:${i}`,
          kind: "session_start",
          ts: start.ts,
        });
      }
      continue;
    }

    if (!ctx.start || !kind) continue;
    if (sessionId && sessionId !== ctx.start.sessionId) {
      continue;
    }
    if (ts) {
      ctx.updatedAt = newerTimestamp(ctx.updatedAt!, ts);
    }

    const fullCtx = ctx as ParseContext;
    if (kind === "token_usage") {
      const tokenUsage = parseTokenUsageLine(parsed);
      if (tokenUsage) {
        fullCtx.tokenUsage.push(tokenUsage);
      }
    } else if (kind === "prompt") {
      handlePromptLine(fullCtx, parsed, ts, i);
    } else if (kind === "response") {
      handleResponseLine(fullCtx, parsed, ts, i);
    } else if (kind === "beat_state") {
      handleBeatStateLine(fullCtx, parsed);
    } else if (kind === "session_end") {
      handleSessionEndLine(fullCtx, parsed, ts, i);
    }
  }

  if (!ctx.start) return null;

  return {
    start: ctx.start,
    updatedAt: ctx.updatedAt || ctx.start.ts,
    endedAt: ctx.endedAt,
    status: ctx.status,
    exitCode: ctx.exitCode,
    entries: ctx.entries!,
    tokenUsage: ctx.tokenUsage!,
    titleHints: ctx.titleHints!,
    workflowStates: Array.from(
      ctx.workflowStates!.values(),
    ).sort(naturalCompare),
  };
}
