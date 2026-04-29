/**
 * Renderer for OpenCode-translated events that do not
 * flow through Claude-shape normalization.
 *
 * tool_use and tool_result are already rendered by the
 * generic Claude formatters (formatAssistantEvent and
 * formatToolResult). The events handled here are
 * OpenCode-native session/step lifecycle markers,
 * file/snapshot parts, and reasoning — for which the
 * generic adhoc formatter would either drop them or
 * print a useless `<event-name> | (no text)` line.
 */
import type { FormattedEvent } from "@/lib/terminal-manager-format";

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

function toObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function formatReasoning(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const text = asString(obj.text);
  if (!text) return null;
  const trailing = text.endsWith("\n") ? "" : "\n";
  return {
    text: `${C.magenta}${text}${C.reset}${trailing}`,
    isDetail: true,
  };
}

function formatStepUpdated(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const step = toObject(obj.step) ?? {};
  const name = asString(step.name);
  const status = asString(step.status)
    || asString(step.state);
  if (!name && !status) return null;
  const label = [name, status].filter(Boolean).join(" ");
  return {
    text: `${C.dim}▷ step ${label}${C.reset}\n`,
    isDetail: true,
  };
}

function formatSessionIdle(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const sessionID = asString(obj.sessionID);
  const tag = sessionID ? ` ${sessionID}` : "";
  return {
    text: `${C.dim}▷ session idle${tag}${C.reset}\n`,
    isDetail: true,
  };
}

function formatSessionError(
  obj: Record<string, unknown>,
): FormattedEvent {
  const message = asString(obj.message)
    || "OpenCode session error";
  return {
    text: `${C.red}✗ ${message}${C.reset}\n`,
    isDetail: false,
  };
}

function formatFile(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const filename = asString(obj.filename);
  if (!filename) return null;
  const mime = asString(obj.mime);
  const mimeTag = mime ? ` ${C.dim}(${mime})${C.reset}` : "";
  return {
    text: `${C.cyan}📎 ${filename}${C.reset}${mimeTag}\n`,
    isDetail: true,
  };
}

function formatSnapshot(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const snapshot = asString(obj.snapshot);
  if (!snapshot) return null;
  return {
    text: `${C.dim}↳ snapshot ${clip(snapshot, 64)}${C.reset}\n`,
    isDetail: true,
  };
}

function formatMessageUpdated(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const info = toObject(obj.info) ?? {};
  const time = toObject(info.time);
  const completed = time?.completed;
  if (completed === undefined || completed === null) {
    return null;
  }
  return {
    text: `${C.dim}▷ turn complete${C.reset}\n`,
    isDetail: true,
  };
}

export function formatOpenCodeEvent(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const type = asString(obj.type);
  if (!type) return null;
  switch (type) {
    case "reasoning":
      return formatReasoning(obj);
    case "step_updated":
      return formatStepUpdated(obj);
    case "session_idle":
      return formatSessionIdle(obj);
    case "session_error":
      return formatSessionError(obj);
    case "file":
      return formatFile(obj);
    case "snapshot":
      return formatSnapshot(obj);
    case "message_updated":
      return formatMessageUpdated(obj);
    default:
      return null;
  }
}
