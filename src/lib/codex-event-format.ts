/**
 * Renderer for Codex-translated events
 * (`item.*`, `turn.*`,
 * `command_execution.terminal_interaction`).
 *
 * The generic `extractEventPayload` fallback collapses
 * these into `<event-name> | (no text)` because the
 * displayable text lives under `obj.item.text` /
 * `obj.item.aggregated_output`, not at the top level.
 *
 * This formatter knows the codex-jsonrpc-translate
 * shape and produces concise, human-readable lines.
 * Returns null for events that are pure noise (e.g.
 * `item.started` for a streaming agent message);
 * the caller should fall through to other formatters
 * or simply drop.
 */
import type { FormattedEvent } from "@/lib/terminal-manager-format";

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

export function formatCodexEvent(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const type = asString(obj.type);
  if (!type) return null;
  if (type === "turn.started") return turnStarted();
  if (type === "turn.completed") return turnCompleted();
  if (type === "turn.failed") return turnFailed(obj);
  if (type === "command_execution.terminal_interaction") {
    return terminalInteraction(obj);
  }
  if (
    type === "item.started" ||
    type === "item.completed" ||
    type === "item.delta"
  ) {
    return formatItemEvent(type, obj);
  }
  return null;
}

function turnStarted(): FormattedEvent {
  return {
    text: `${C.dim}▷ turn started${C.reset}\n`,
    isDetail: true,
  };
}

function turnCompleted(): FormattedEvent {
  return {
    text: `${C.dim}▷ turn completed${C.reset}\n`,
    isDetail: true,
  };
}

function turnFailed(
  obj: Record<string, unknown>,
): FormattedEvent {
  const error = toObject(obj.error);
  const message = asString(error?.message)
    || "Turn failed (no error message)";
  return {
    text: `${C.red}✗ turn failed: ${message}${C.reset}\n`,
    isDetail: false,
  };
}

function terminalInteraction(
  obj: Record<string, unknown>,
): FormattedEvent {
  const item = toObject(obj.item);
  const itemId = asString(item?.id) || "?";
  const processId = asString(obj.processId) || "?";
  const stdin = asString(obj.stdin);
  const stdinPart = stdin
    ? ` stdin=${JSON.stringify(clip(stdin, 60))}`
    : " stdin=(empty)";
  return {
    text:
      `${C.dim}↳ terminal interaction ` +
      `id=${itemId} pid=${processId}${stdinPart}` +
      `${C.reset}\n`,
    isDetail: true,
  };
}

function formatItemEvent(
  eventType: "item.started" | "item.completed"
    | "item.delta",
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const item = toObject(obj.item);
  const itemType = asString(item?.type);
  if (!item || !itemType) return null;
  if (itemType === "command_execution") {
    return formatCommandEvent(eventType, obj, item);
  }
  if (itemType === "agent_message") {
    return formatAgentMessageEvent(
      eventType, obj, item,
    );
  }
  if (itemType === "reasoning") {
    return formatReasoningEvent(eventType, obj, item);
  }
  return null;
}

function formatCommandEvent(
  eventType: "item.started" | "item.completed"
    | "item.delta",
  obj: Record<string, unknown>,
  item: Record<string, unknown>,
): FormattedEvent | null {
  if (eventType === "item.started") {
    const command = clip(
      asString(item.command) || "(no command)", 200,
    );
    return {
      text: `${C.cyan}▶ ${command}${C.reset}\n`,
      isDetail: true,
    };
  }
  if (eventType === "item.delta") {
    const text = asString(obj.text);
    if (!text) return null;
    return {
      text: `${C.dim}${text}${C.reset}`,
      isDetail: true,
    };
  }
  // item.completed
  const output = asString(item.aggregated_output);
  const status = asString(item.status);
  const statusTag = status && status !== "completed"
    ? ` ${C.yellow}[${status}]${C.reset}`
    : "";
  if (!output) {
    return {
      text:
        `${C.dim}↳ command finished${statusTag}` +
        `${C.reset}\n`,
      isDetail: true,
    };
  }
  const trimmed = clip(output, 1500);
  return {
    text:
      `${C.dim}${trimmed}${C.reset}` +
      `${statusTag ? statusTag + "\n" : "\n"}`,
    isDetail: true,
  };
}

function formatAgentMessageEvent(
  eventType: "item.started" | "item.completed"
    | "item.delta",
  obj: Record<string, unknown>,
  item: Record<string, unknown>,
): FormattedEvent | null {
  // item.started for agent_message carries no
  // useful text — deltas follow. Drop.
  if (eventType === "item.started") return null;
  if (eventType === "item.delta") {
    const text = asString(obj.text);
    if (!text) return null;
    return { text, isDetail: false };
  }
  // item.completed
  const text = asString(item.text);
  if (!text) return null;
  // Add trailing newline so the next event renders on
  // its own line — deltas may have left the cursor mid
  // line.
  const finalText = text.endsWith("\n")
    ? text : text + "\n";
  return { text: finalText, isDetail: false };
}

function formatReasoningEvent(
  eventType: "item.started" | "item.completed"
    | "item.delta",
  obj: Record<string, unknown>,
  item: Record<string, unknown>,
): FormattedEvent | null {
  if (eventType === "item.started") return null;
  const text = eventType === "item.delta"
    ? asString(obj.text)
    : asString(item.text);
  if (!text) return null;
  return {
    text: `${C.magenta}${text}${C.reset}` +
      (text.endsWith("\n") ? "" : "\n"),
    isDetail: true,
  };
}
