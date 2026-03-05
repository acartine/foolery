import { describe, expect, it, vi } from "vitest";

import {
  buildContentBlockDelta,
  buildContentBlockStart,
  buildContentBlockStop,
  buildEndEvents,
  buildMessageDelta,
  buildMessageStop,
  buildMessageStart,
  parseArgs,
  processStream,
  translateChunk,
} from "../openrouter-agent";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses -p and uses defaults for model and output-format", () => {
    const result = parseArgs(["-p", "hello world"]);
    expect(result).toEqual({
      prompt: "hello world",
      model: "openai/gpt-4o",
      outputFormat: "stream-json",
    });
  });

  it("parses all flags", () => {
    const result = parseArgs([
      "-p",
      "test prompt",
      "--model",
      "anthropic/claude-3-haiku",
      "--output-format",
      "stream-json",
    ]);
    expect(result).toEqual({
      prompt: "test prompt",
      model: "anthropic/claude-3-haiku",
      outputFormat: "stream-json",
    });
  });

  it("throws when prompt is missing", () => {
    expect(() => parseArgs(["--model", "foo"])).toThrow(
      "Missing required argument: -p <prompt>",
    );
  });

  it("throws on unsupported output format", () => {
    expect(() =>
      parseArgs(["-p", "hi", "--output-format", "text"]),
    ).toThrow('Unsupported output format: "text"');
  });

  it("handles flags in any order", () => {
    const result = parseArgs([
      "--model",
      "x/y",
      "-p",
      "my prompt",
      "--output-format",
      "stream-json",
    ]);
    expect(result.prompt).toBe("my prompt");
    expect(result.model).toBe("x/y");
  });
});

// ---------------------------------------------------------------------------
// translateChunk
// ---------------------------------------------------------------------------

describe("translateChunk", () => {
  const model = "test/model";

  it("returns done:true for [DONE]", () => {
    const result = translateChunk("[DONE]", false, model);
    expect(result).toEqual({ events: [], done: true });
  });

  it("emits message_start + content_block_start on first chunk", () => {
    const json = JSON.stringify({
      choices: [{ delta: { content: "Hi" } }],
    });
    const result = translateChunk(json, true, model);
    expect(result.done).toBe(false);
    expect(result.events).toHaveLength(3);
    expect(result.events[0].type).toBe("message_start");
    expect(result.events[1].type).toBe("content_block_start");
    expect(result.events[2].type).toBe("content_block_delta");
  });

  it("emits only content_block_delta on subsequent chunks", () => {
    const json = JSON.stringify({
      choices: [{ delta: { content: "world" } }],
    });
    const result = translateChunk(json, false, model);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(buildContentBlockDelta("world"));
  });

  it("emits no delta when content is missing", () => {
    const json = JSON.stringify({ choices: [{ delta: {} }] });
    const result = translateChunk(json, false, model);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// builder helpers
// ---------------------------------------------------------------------------

describe("stream event builders", () => {
  it("buildMessageStart has correct shape", () => {
    const ev = buildMessageStart("test/model");
    expect(ev.type).toBe("message_start");
    const msg = ev.message as Record<string, unknown>;
    expect(msg.role).toBe("assistant");
    expect(msg.model).toBe("test/model");
    expect(msg.stop_reason).toBeNull();
  });

  it("buildContentBlockStart has correct shape", () => {
    const ev = buildContentBlockStart();
    expect(ev).toEqual({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
  });

  it("buildContentBlockDelta includes text", () => {
    const ev = buildContentBlockDelta("hello");
    expect(ev).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hello" },
    });
  });

  it("buildContentBlockStop", () => {
    expect(buildContentBlockStop()).toEqual({
      type: "content_block_stop",
      index: 0,
    });
  });

  it("buildMessageDelta", () => {
    const ev = buildMessageDelta();
    expect(ev.type).toBe("message_delta");
    expect((ev.delta as Record<string, unknown>).stop_reason).toBe("end_turn");
  });

  it("buildMessageStop", () => {
    expect(buildMessageStop()).toEqual({ type: "message_stop" });
  });

  it("buildEndEvents returns 3 closing events in order", () => {
    const events = buildEndEvents();
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("content_block_stop");
    expect(events[1].type).toBe("message_delta");
    expect(events[2].type).toBe("message_stop");
  });
});

// ---------------------------------------------------------------------------
// processStream
// ---------------------------------------------------------------------------

describe("processStream", () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it("emits start events before end events when [DONE] arrives first", async () => {
    const lines: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((line: string | Uint8Array) => {
        lines.push(typeof line === "string" ? line : new TextDecoder().decode(line));
        return true;
      }) as typeof process.stdout.write);

    try {
      await processStream(makeStream(["data: [DONE]\n\n"]), "model/test");
    } finally {
      writeSpy.mockRestore();
    }

    const events = lines.map((line) => JSON.parse(line.trim()));
    expect(events.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });
});
