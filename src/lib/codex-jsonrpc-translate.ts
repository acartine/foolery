/**
 * Codex JSON-RPC notification → flat event translator.
 *
 * Lives in its own module so the session client stays
 * focused on transport. Each helper takes the raw
 * notification params and returns a normalized event
 * (or null when the notification is non-displayable
 * noise — empty reasoning, prompt echoes, etc.).
 *
 * Translator output shape:
 *   - `turn.started`, `turn.completed`, `turn.failed`
 *   - `item.started`, `item.completed`, `item.delta`
 *   - `command_execution.terminal_interaction`
 *
 * Empty/no-content events MUST be dropped here; the
 * downstream formatter would render them as `(no text)`.
 */

const TRANSLATED_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
]);

export function isTranslatedMethod(
  method: string,
): boolean {
  return TRANSLATED_METHODS.has(method);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

// ── Item translation ──────────────────────────────────

export function translateItemNotification(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const item = asObject(params.item);
  if (!item) return null;
  // Filter our own prompt being echoed back.
  if (item.type === "userMessage") return null;
  const eventType = method === "item/started"
    ? "item.started" : "item.completed";

  if (item.type === "commandExecution") {
    return translateCommandExecution(item, eventType);
  }
  if (item.type === "agentMessage") {
    return translateAgentMessage(item, eventType);
  }
  if (item.type === "reasoning") {
    return translateReasoning(item, eventType);
  }
  return null;
}

function translateCommandExecution(
  item: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> {
  const command = extractCommand(item);
  // Codex emits `output` on completion in some
  // builds and `aggregatedOutput` in others; accept
  // either so command output is never lost.
  const output =
    asString(item.output) ||
    asString(item.aggregatedOutput);
  return {
    type: eventType,
    item: {
      type: "command_execution",
      id: item.id,
      command,
      aggregated_output: output,
      status: asString(item.status) || undefined,
    },
  };
}

function extractCommand(
  item: Record<string, unknown>,
): string {
  if (typeof item.command === "string") {
    return item.command;
  }
  const call = asObject(item.call);
  if (call && typeof call.command === "string") {
    return call.command;
  }
  return "";
}

function translateAgentMessage(
  item: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> | null {
  // `item/started` for agentMessage carries no text;
  // text streams via item/agentMessage/delta. We still
  // surface the start as a marker so the UI can show
  // a fresh assistant message is beginning.
  if (eventType === "item.started") {
    return {
      type: "item.started",
      item: { type: "agent_message", id: item.id },
    };
  }
  const text = collectText(item.fragments)
    || asString(item.text);
  return {
    type: "item.completed",
    item: {
      type: "agent_message", id: item.id, text,
    },
  };
}

function translateReasoning(
  item: Record<string, unknown>,
  eventType: string,
): Record<string, unknown> | null {
  if (eventType === "item.started") return null;
  // Newer Codex builds use `summary` (array of
  // {type:"summary_text", text}); older mirror it
  // as `summaryParts`. Try both.
  const text =
    collectText(item.summary) ||
    collectText(item.summaryParts) ||
    collectText(item.content);
  // Empty reasoning items are noise — Codex emits
  // them once per turn before any content streams.
  if (!text) return null;
  return {
    type: "item.completed",
    item: { type: "reasoning", text },
  };
}

function collectText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const entry of value) {
    const obj = asObject(entry);
    if (!obj) continue;
    const text = asString(obj.text);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

// ── Streaming delta translation ───────────────────────

export function translateAgentMessageDelta(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  // Live Codex builds publish `params.delta`; older
  // documentation said `params.text`. Accept both so
  // we never silently drop streamed assistant text.
  const text =
    asString(params.delta) || asString(params.text);
  if (!text) return null;
  return {
    type: "item.delta",
    item: {
      type: "agent_message",
      id: asString(params.itemId) || undefined,
    },
    text,
  };
}

export function translateReasoningDelta(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const text =
    asString(params.delta) || asString(params.text);
  if (!text) return null;
  return {
    type: "item.delta",
    item: {
      type: "reasoning",
      id: asString(params.itemId) || undefined,
    },
    text,
  };
}

export function translateOutputDelta(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const text =
    asString(params.delta) || asString(params.text);
  if (!text) return null;
  return {
    type: "item.delta",
    item: {
      type: "command_execution",
      id: asString(params.itemId) || undefined,
    },
    text,
  };
}

export function translateTerminalInteraction(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const itemId = asString(params.itemId);
  const processId = asString(params.processId);
  const stdin = asString(params.stdin);
  if (!itemId && !processId && !stdin) return null;
  return {
    type: "command_execution.terminal_interaction",
    item: {
      type: "command_execution",
      id: itemId || undefined,
    },
    processId: processId || undefined,
    stdin,
  };
}

// ── Turn lifecycle ────────────────────────────────────

export function translateTurnCompleted(
  params: Record<string, unknown>,
): {
  event: Record<string, unknown>;
  turnFailed: boolean;
} {
  const turn = asObject(params.turn);
  if (turn?.status === "failed") {
    const error = asObject(turn.error);
    return {
      event: {
        type: "turn.failed",
        error: {
          message:
            asString(error?.message) || "Turn failed",
        },
      },
      turnFailed: true,
    };
  }
  return {
    event: { type: "turn.completed" },
    turnFailed: false,
  };
}
