import type { AgentHistoryEntry, AgentHistorySession } from "@/lib/agent-history-types";

const MAX_SUMMARY_CHARS = 1_200;

export interface BuildDebugPromptOptions {
  session: Pick<
    AgentHistorySession,
    | "sessionId"
    | "interactionType"
    | "repoPath"
    | "beatIds"
    | "startedAt"
    | "updatedAt"
    | "entries"
    | "agentName"
    | "agentModel"
    | "agentVersion"
  >;
  expectedOutcome: string;
  actualOutcome: string;
}

function clipText(text: string, maxChars = MAX_SUMMARY_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const extra = trimmed.length - maxChars;
  return `${trimmed.slice(0, maxChars)}\n... [truncated ${extra} chars]`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function summarizeAssistantPayload(payload: Record<string, unknown>): string | null {
  const message = toObject(payload.message);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;

  const parts: string[] = [];
  for (const blockRaw of content) {
    const block = toObject(blockRaw);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text.trim();
      if (text) parts.push(text);
      continue;
    }
    if (block.type === "tool_use") {
      const name = typeof block.name === "string" ? block.name : "tool";
      const input = toObject(block.input);
      const detail =
        typeof input?.command === "string"
          ? input.command
          : typeof input?.description === "string"
            ? input.description
            : typeof input?.file_path === "string"
              ? input.file_path
              : "";
      parts.push(detail ? `tool:${name} ${detail}` : `tool:${name}`);
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n");
}

function summarizeUserPayload(payload: Record<string, unknown>): string | null {
  const message = toObject(payload.message);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;

  for (const blockRaw of content) {
    const block = toObject(blockRaw);
    if (!block) continue;
    if (block.type === "tool_result") {
      if (typeof block.content === "string") return block.content;
      return JSON.stringify(block.content);
    }
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }

  return null;
}

function summarizeResultPayload(payload: Record<string, unknown>): string | null {
  const result = typeof payload.result === "string" ? payload.result : null;
  const cost =
    typeof payload.cost_usd === "number" ? `$${payload.cost_usd.toFixed(4)}` : null;
  const duration =
    typeof payload.duration_ms === "number"
      ? `${(payload.duration_ms / 1000).toFixed(1)}s`
      : null;
  if (!result && !cost && !duration) return null;
  const meta = [cost, duration].filter(Boolean).join(", ");
  if (!result) return meta;
  return meta ? `${result} (${meta})` : result;
}

function summarizeSystemPayload(payload: Record<string, unknown>): string | null {
  const subtype = typeof payload.subtype === "string" ? payload.subtype : "event";
  const hook = typeof payload.hook_name === "string" ? payload.hook_name : null;
  const outcome = typeof payload.outcome === "string" ? payload.outcome : null;
  return [subtype, hook, outcome].filter(Boolean).join(" · ");
}

function summarizeRawResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return clipText(raw);

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    const type = typeof payload.type === "string" ? payload.type : "";
    const summary =
      type === "assistant"
        ? summarizeAssistantPayload(payload)
        : type === "user"
          ? summarizeUserPayload(payload)
          : type === "result"
            ? summarizeResultPayload(payload)
            : type === "system"
              ? summarizeSystemPayload(payload)
              : JSON.stringify(payload, null, 2);
    return clipText(summary ?? raw);
  } catch {
    return clipText(raw);
  }
}

function summarizeEntry(entry: AgentHistoryEntry): string {
  if (entry.kind === "session_start") {
    return "Session started";
  }
  if (entry.kind === "session_end") {
    const status = entry.status ?? "unknown";
    const exitCode =
      typeof entry.exitCode === "number" ? `, exit ${entry.exitCode}` : "";
    return `Session ended with status ${status}${exitCode}`;
  }
  if (entry.kind === "prompt") {
    const parts = [`Prompt #${entry.promptNumber ?? "?"}`];
    if (entry.promptSource) parts.push(entry.promptSource);
    if (entry.workflowState) parts.push(entry.workflowState);
    const label = parts.join(" | ");
    return `${label}\n${clipText(entry.prompt ?? "(empty prompt)")}`;
  }
  return `Response${entry.status ? ` | ${entry.status}` : ""}\n${summarizeRawResponse(entry.raw ?? "")}`;
}

export function summarizeSessionEntries(entries: AgentHistoryEntry[]): string {
  if (entries.length === 0) return "No session entries were recorded.";
  return entries
    .map((entry) => `- [${formatTime(entry.ts)}] ${summarizeEntry(entry)}`)
    .join("\n\n");
}

export function buildDebugPrompt({
  session,
  expectedOutcome,
  actualOutcome,
}: BuildDebugPromptOptions): string {
  const beats = session.beatIds.length > 0 ? session.beatIds.join(", ") : "(none)";
  const agentParts = [session.agentName, session.agentModel, session.agentVersion].filter(Boolean);
  const agentLabel = agentParts.length > 0 ? agentParts.join(" / ") : "unknown";

  return [
    "Investigate a prior Foolery history session.",
    "",
    "Expected Outcome",
    expectedOutcome.trim(),
    "",
    "Actual Outcome",
    actualOutcome.trim(),
    "",
    "Session Metadata",
    `- Session ID: ${session.sessionId}`,
    `- Interaction Type: ${session.interactionType}`,
    `- Repo Path: ${session.repoPath}`,
    `- Beat IDs: ${beats}`,
    `- Started At: ${session.startedAt}`,
    `- Updated At: ${session.updatedAt}`,
    `- Agent: ${agentLabel}`,
    "",
    "Session Transcript Summary",
    summarizeSessionEntries(session.entries),
    "",
    "Your task:",
    "1. Explain why the actual outcome likely happened instead of the expected outcome.",
    "2. Ground the explanation in evidence from the session summary above.",
    "3. Call out any missing information or assumptions needed to confirm the root cause.",
    "4. Offer 2-4 concrete next-step options that the user could approve and convert into knots.",
    "5. Do not implement fixes or mutate knots in this response.",
  ].join("\n");
}
