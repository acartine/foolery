#!/usr/bin/env bun

// ---------------------------------------------------------------------------
// openrouter-agent — Standalone CLI that calls OpenRouter and emits
// Claude stream-json formatted output.
// ---------------------------------------------------------------------------

// ---- Arg parsing ----------------------------------------------------------

export interface ParsedArgs {
  prompt: string;
  model: string;
  outputFormat: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let prompt = "";
  let model = "openai/gpt-4o";
  let outputFormat = "stream-json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" && i + 1 < argv.length) {
      prompt = argv[++i];
    } else if (arg === "--model" && i + 1 < argv.length) {
      model = argv[++i];
    } else if (arg === "--output-format" && i + 1 < argv.length) {
      outputFormat = argv[++i];
    }
  }

  if (!prompt) {
    throw new Error("Missing required argument: -p <prompt>");
  }
  if (outputFormat !== "stream-json") {
    throw new Error(
      `Unsupported output format: "${outputFormat}". Only "stream-json" is supported.`,
    );
  }

  return { prompt, model, outputFormat };
}

// ---- SSE → Claude stream-json translation ---------------------------------

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

function makeMessageId(): string {
  const hex = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `msg_${hex}`;
}

export function buildMessageStart(model: string): StreamEvent {
  return {
    type: "message_start",
    message: {
      id: makeMessageId(),
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}

export function buildContentBlockStart(): StreamEvent {
  return {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  };
}

export function buildContentBlockDelta(text: string): StreamEvent {
  return {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  };
}

export function buildContentBlockStop(): StreamEvent {
  return { type: "content_block_stop", index: 0 };
}

export function buildMessageDelta(): StreamEvent {
  return {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 0 },
  };
}

export function buildMessageStop(): StreamEvent {
  return { type: "message_stop" };
}

/**
 * Translate a single SSE `data:` payload into zero or more Claude stream-json
 * events. Returns `null` when the SSE signals `[DONE]`.
 */
export function translateChunk(
  raw: string,
  isFirst: boolean,
  model: string,
): { events: StreamEvent[]; done: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "[DONE]") {
    return { events: [], done: true };
  }

  const parsed = JSON.parse(trimmed) as {
    choices?: { delta?: { content?: string } }[];
  };

  const events: StreamEvent[] = [];

  if (isFirst) {
    events.push(buildMessageStart(model));
    events.push(buildContentBlockStart());
  }

  const content = parsed.choices?.[0]?.delta?.content;
  if (content) {
    events.push(buildContentBlockDelta(content));
  }

  return { events, done: false };
}

export function buildEndEvents(): StreamEvent[] {
  return [buildContentBlockStop(), buildMessageDelta(), buildMessageStop()];
}

// ---- Streaming fetch & main loop ------------------------------------------

async function streamFromOpenRouter(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<void> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new Error(`OpenRouter returned ${res.status}: ${body}`);
  }

  if (!res.body) {
    throw new Error("Response body is null — streaming not supported?");
  }

  await processStream(res.body, model);
}

export async function processStream(
  body: ReadableStream<Uint8Array>,
  model: string,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let isFirst = true;
  const writeEvents = (events: StreamEvent[]) => {
    for (const ev of events) {
      process.stdout.write(JSON.stringify(ev) + "\n");
    }
  };
  const emitStartEventsIfNeeded = () => {
    if (!isFirst) return;
    writeEvents([buildMessageStart(model), buildContentBlockStart()]);
    isFirst = false;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice("data:".length).trim();
        if (!payload) continue;

        const result = translateChunk(payload, isFirst, model);
        if (result.done) {
          emitStartEventsIfNeeded();
          writeEvents(buildEndEvents());
          return;
        }
        writeEvents(result.events);
        if (isFirst && result.events.length > 0) isFirst = false;
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Stream ended without [DONE] — emit closing events anyway.
  emitStartEventsIfNeeded();
  writeEvents(buildEndEvents());
}

// ---- Entry point ----------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    process.stderr.write("Error: OPENROUTER_API_KEY environment variable is not set.\n");
    process.exit(1);
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  try {
    await streamFromOpenRouter(apiKey, args.model, args.prompt);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// Only run when executed directly (not when imported by tests).
// Bun exposes import.meta.main; Node does not, so we also check argv[1].
const isMain =
  (import.meta as unknown as { main?: boolean }).main ??
  process.argv[1]?.endsWith("openrouter-agent.ts") ??
  false;

if (isMain) {
  main();
}
