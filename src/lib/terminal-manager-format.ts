import type { TerminalEvent } from "@/lib/types";

export type JsonObject = Record<string, unknown>;

export function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  return value as JsonObject;
}

export function buildAutoAskUserResponse(input: unknown): string {
  const payload = toObject(input);
  const rawQuestions = payload?.questions;
  const questions = Array.isArray(rawQuestions) ? rawQuestions : [];

  if (questions.length === 0) {
    return [
      "Ship mode auto-response (non-interactive):",
      "- No question payload was provided.",
      "- Proceed with your best assumptions and continue implementation.",
    ].join("\n");
  }

  const lines: string[] = ["Ship mode auto-response (non-interactive):"];
  for (const [index, rawQuestion] of questions.entries()) {
    const question = toObject(rawQuestion);
    const prompt =
      typeof question?.question === "string"
        ? question.question
        : `Question ${index + 1}`;
    const rawOptions = question?.options;
    const options = Array.isArray(rawOptions) ? rawOptions : [];

    if (options.length === 0) {
      lines.push(
        `${index + 1}. ${prompt}: no options provided; ` +
        `proceed with your best assumption.`,
      );
      continue;
    }

    const firstOption = toObject(options[0]);
    const label =
      typeof firstOption?.label === "string" && firstOption.label.trim()
        ? firstOption.label.trim()
        : "first option";

    lines.push(`${index + 1}. ${prompt}: choose "${label}".`);
  }

  lines.push(
    "Continue without waiting for additional input " +
    "unless blocked by a hard error.",
  );
  return lines.join("\n");
}

export function makeUserMessageLine(text: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  }) + "\n";
}

export function makeCopilotUserMessageLine(
  text: string,
): string {
  return JSON.stringify({
    type: "user_message",
    data: { content: text },
  }) + "\n";
}

function compactValue(value: unknown, max = 220): string {
  const rendered =
    typeof value === "string"
      ? value
      : JSON.stringify(value);
  if (!rendered) return "";
  return rendered.length > max
    ? `${rendered.slice(0, max)}...`
    : rendered;
}

export function extractEventPayload(value: unknown): {
  event: string;
  text: string;
  extras: Array<{ key: string; value: string }>;
} | null {
  const obj = toObject(value);
  if (!obj) return null;

  const eventName =
    typeof obj.event === "string"
      ? obj.event
      : typeof obj.type === "string"
        ? obj.type
        : null;
  if (!eventName) return null;

  const delta = toObject(obj.delta);
  const text =
    typeof obj.text === "string"
      ? obj.text
      : typeof obj.message === "string"
        ? obj.message
        : typeof obj.result === "string"
          ? obj.result
          : typeof obj.summary === "string"
            ? obj.summary
            : typeof delta?.text === "string"
              ? delta.text
              : "";

  const skipKeys = [
    "event", "type", "text", "message",
    "result", "summary", "delta",
  ];
  const extras = Object.entries(obj)
    .filter(([key]) => !skipKeys.includes(key))
    .map(([key, raw]) => ({ key, value: compactValue(raw) }))
    .filter((entry) => entry.value.length > 0);

  return {
    event: eventName,
    text: text.trim(),
    extras,
  };
}

export function formatEventPayload(payload: {
  event: string;
  text: string;
  extras: Array<{ key: string; value: string }>;
}): string {
  const out: string[] = [];
  const header =
    `\x1b[35m${payload.event}\x1b[0m \x1b[90m|\x1b[0m ` +
    `${payload.text || "(no text)"}\n`;
  out.push(header);
  for (const extra of payload.extras) {
    out.push(
      `\x1b[90m  ${extra.key}: ${extra.value}\x1b[0m\n`,
    );
  }
  return out.join("");
}

export function formatEventTextLines(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const hadTrailingNewline = text.endsWith("\n");
  const out: string[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        const payload = extractEventPayload(parsed);
        if (payload) {
          out.push(formatEventPayload(payload));
          continue;
        }
      } catch {
        // Fall through to raw line output.
      }
    }

    if (line.length > 0) out.push(`${line}\n`);
    else if (idx < lines.length - 1 || hadTrailingNewline) {
      out.push("\n");
    }
  }

  return out.join("");
}

export interface FormattedEvent {
  text: string;
  /** When true, detail content (hidden when toggle is off). */
  isDetail: boolean;
}

/** Push formatted event to the terminal buffer. */
export function pushFormattedEvent(
  formatted: FormattedEvent,
  push: (evt: TerminalEvent) => void,
): void {
  const evtType = formatted.isDetail
    ? "stdout_detail"
    : "stdout";
  push({
    type: evtType,
    data: formatted.text,
    timestamp: Date.now(),
  });
}

/** Format a stream-json event into human-readable output. */
export function formatStreamEvent(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  return formatAssistantEvent(obj)
    ?? formatStreamDelta(obj)
    ?? formatToolResult(obj)
    ?? formatAdHocOrResult(obj);
}

function formatAssistantEvent(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  if (obj.type !== "assistant") return null;
  if (typeof obj.message !== "object" || !obj.message) return null;
  const msg = obj.message as Record<string, unknown>;
  const content = msg.content as
    Array<Record<string, unknown>> | undefined;
  if (!content) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(formatEventTextLines(block.text));
    } else if (block.type === "tool_use") {
      const name = block.name as string;
      const input = block.input as
        Record<string, unknown> | undefined;
      let summary = "";
      if (input) {
        if (input.command) {
          summary = ` ${String(input.command).slice(0, 120)}`;
        } else if (input.file_path) {
          summary = ` ${input.file_path}`;
        } else if (input.pattern) {
          summary = ` ${input.pattern}`;
        }
      }
      parts.push(`\x1b[36m▶ ${name}${summary}\x1b[0m\n`);
    }
  }
  const text = parts.join("");
  return text ? { text, isDetail: false } : null;
}

function formatStreamDelta(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  if (obj.type !== "stream_event") return null;
  const streamEvent = toObject(obj.event);
  if (!streamEvent) return null;
  const payload = extractEventPayload(streamEvent);
  if (payload) {
    return { text: formatEventPayload(payload), isDetail: true };
  }
  const delta = toObject(streamEvent.delta);
  if (typeof delta?.text === "string") {
    const text = formatEventTextLines(delta.text);
    return text ? { text, isDetail: true } : null;
  }
  return null;
}

function formatToolResult(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  if (obj.type !== "user") return null;
  if (typeof obj.message !== "object" || !obj.message) return null;
  const msg = obj.message as Record<string, unknown>;
  const content = msg.content as
    Array<Record<string, unknown>> | undefined;
  if (!content) return null;
  for (const block of content) {
    if (block.type === "tool_result") {
      const text = typeof block.content === "string"
        ? block.content
        : JSON.stringify(block.content);
      const abbrev = text.length > 500
        ? text.slice(0, 500) + "...\n"
        : text;
      const rendered = formatEventTextLines(abbrev);
      return {
        text: `\x1b[90m${rendered || abbrev}\x1b[0m\n`,
        isDetail: true,
      };
    }
  }
  return null;
}

function formatAdHocOrResult(
  obj: Record<string, unknown>,
): FormattedEvent | null {
  const adHocEvent = extractEventPayload(obj);
  if (adHocEvent) {
    return {
      text: formatEventPayload(adHocEvent),
      isDetail: true,
    };
  }

  if (obj.type !== "result") return null;
  const result = obj.result as string | undefined;
  const isError = Boolean(obj.is_error);
  const cost = obj.cost_usd as number | undefined;
  const dur = obj.duration_ms as number | undefined;
  const parts: string[] = [];
  if (result) {
    parts.push(
      isError ? `\x1b[31m${result}\x1b[0m` : result,
    );
  }
  if (cost !== undefined || dur !== undefined) {
    const meta: string[] = [];
    if (cost !== undefined) meta.push(`$${cost.toFixed(4)}`);
    if (dur !== undefined) {
      meta.push(`${(dur / 1000).toFixed(1)}s`);
    }
    parts.push(`\x1b[90m(${meta.join(", ")})\x1b[0m`);
  }
  return { text: parts.join(" ") + "\n", isDetail: true };
}
