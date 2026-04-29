/**
 * Hermetic tests for the pure OpenCode event/part
 * translator. Covers each part type, each SSE envelope
 * type, response aggregation, and payload detection.
 */
import { describe, it, expect } from "vitest";
import {
  translateOpenCodePart,
  translateOpenCodeEvent,
  translateOpenCodeResponse,
  hasOpenCodeMessagePayload,
} from "@/lib/opencode-event-translate";

describe("translateOpenCodePart simple", () => {
  it("translates step-start", () => {
    expect(translateOpenCodePart({ type: "step-start" }))
      .toEqual([{ type: "step_start" }]);
  });

  it("translates text", () => {
    const out = translateOpenCodePart({
      type: "text",
      text: "hello",
    });
    expect(out).toEqual([{
      type: "text",
      part: { text: "hello" },
    }]);
  });

  it("translates step-finish with reason", () => {
    expect(translateOpenCodePart({
      type: "step-finish",
      reason: "stop",
    })).toEqual([{
      type: "step_finish",
      part: { reason: "stop" },
    }]);
  });

  it("translates step-finish with no reason as stop", () => {
    expect(translateOpenCodePart({
      type: "step-finish",
    })).toEqual([{
      type: "step_finish",
      part: { reason: "stop" },
    }]);
  });

  it("returns empty for unknown part types", () => {
    expect(translateOpenCodePart({
      type: "totally-unknown",
    })).toEqual([]);
  });
});

describe("translateOpenCodePart tool", () => {
  it("translates a running tool part to tool_use only", () => {
    const out = translateOpenCodePart({
      type: "tool",
      id: "call_1",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "ls -la" },
      },
    });
    expect(out).toEqual([{
      type: "tool_use",
      id: "call_1",
      name: "bash",
      input: { command: "ls -la" },
      status: "running",
    }]);
  });

  it("translates a completed tool to tool_use + tool_result", () => {
    const out = translateOpenCodePart({
      type: "tool",
      id: "call_2",
      tool: "read",
      state: {
        status: "completed",
        input: { file_path: "/tmp/x" },
        output: "file contents",
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: "tool_use",
      id: "call_2",
      name: "read",
      status: "completed",
    });
    expect(out[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call_2",
      content: "file contents",
      status: "completed",
    });
  });

  it("does not emit tool_result for pending tool parts", () => {
    const out = translateOpenCodePart({
      type: "tool",
      id: "call_3",
      tool: "edit",
      state: { status: "pending" },
    });
    expect(out).toEqual([{
      type: "tool_use",
      id: "call_3",
      name: "edit",
      input: {},
      status: "pending",
    }]);
  });
});

describe("translateOpenCodePart misc", () => {
  it("translates reasoning parts", () => {
    expect(translateOpenCodePart({
      type: "reasoning",
      text: "thinking…",
    })).toEqual([{
      type: "reasoning",
      text: "thinking…",
    }]);
  });

  it("translates file parts with mime/source", () => {
    expect(translateOpenCodePart({
      type: "file",
      filename: "/tmp/a.png",
      mime: "image/png",
      source: "agent",
    })).toEqual([{
      type: "file",
      filename: "/tmp/a.png",
      mime: "image/png",
      source: "agent",
    }]);
  });

  it("translates snapshot parts", () => {
    expect(translateOpenCodePart({
      type: "snapshot",
      snapshot: "abc123",
    })).toEqual([{
      type: "snapshot",
      snapshot: "abc123",
    }]);
  });
});

describe("translateOpenCodeEvent permissions", () => {
  it("forwards permission.asked at the top level", () => {
    const event = {
      type: "permission.asked",
      sessionID: "ses_1",
      requestID: "req_1",
    };
    expect(translateOpenCodeEvent(event)).toEqual([event]);
  });

  it("forwards permission.updated inside name/event field", () => {
    const out = translateOpenCodeEvent({
      event: "permission.updated",
      sessionID: "ses_1",
    });
    expect(out).toEqual([{
      event: "permission.updated",
      sessionID: "ses_1",
      type: "permission.updated",
    }]);
  });
});

describe("translateOpenCodeEvent message updates", () => {
  it("translates message.part.updated wrapping a tool", () => {
    const out = translateOpenCodeEvent({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          id: "call_a",
          tool: "grep",
          state: {
            status: "completed",
            input: { pattern: "foo" },
            output: "match",
          },
        },
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: "tool_use",
      id: "call_a",
      name: "grep",
    });
    expect(out[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call_a",
      content: "match",
    });
  });

  it("falls back to data.part for message.part.updated", () => {
    const out = translateOpenCodeEvent({
      type: "message.part.updated",
      data: { part: { type: "text", text: "hi" } },
    });
    expect(out).toEqual([{
      type: "text",
      part: { text: "hi" },
    }]);
  });

  it("translates message.updated to message_updated", () => {
    const out = translateOpenCodeEvent({
      type: "message.updated",
      properties: {
        info: { time: { completed: 12345 } },
      },
    });
    expect(out).toEqual([{
      type: "message_updated",
      info: { time: { completed: 12345 } },
    }]);
  });
});

describe("translateOpenCodeEvent session lifecycle", () => {
  it("translates step.updated", () => {
    const out = translateOpenCodeEvent({
      type: "step.updated",
      properties: { step: { name: "review", status: "running" } },
    });
    expect(out).toEqual([{
      type: "step_updated",
      step: { name: "review", status: "running" },
    }]);
  });

  it("translates session.idle to session_idle", () => {
    const out = translateOpenCodeEvent({
      type: "session.idle",
      properties: { sessionID: "ses_idle_1" },
    });
    expect(out).toEqual([{
      type: "session_idle",
      sessionID: "ses_idle_1",
    }]);
  });

  it("translates session.error to session_error", () => {
    const out = translateOpenCodeEvent({
      type: "session.error",
      properties: {
        error: { message: "rate limited" },
      },
    });
    expect(out).toEqual([{
      type: "session_error",
      error: { message: "rate limited" },
      message: "rate limited",
    }]);
  });

  it("returns empty for unknown SSE envelopes", () => {
    expect(translateOpenCodeEvent({ type: "totally.new" }))
      .toEqual([]);
  });

  it("returns empty for non-objects", () => {
    expect(translateOpenCodeEvent("not an object"))
      .toEqual([]);
    expect(translateOpenCodeEvent(null)).toEqual([]);
  });
});

describe("translateOpenCodeResponse", () => {
  it("translates a response with mixed parts in order", () => {
    const out = translateOpenCodeResponse({
      parts: [
        { type: "step-start" },
        { type: "text", text: "ok" },
        {
          type: "tool",
          id: "t1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo" },
            output: "echo\n",
          },
        },
        { type: "step-finish", reason: "stop" },
      ],
    });
    expect(out.map((e) => e.type)).toEqual([
      "step_start",
      "text",
      "tool_use",
      "tool_result",
      "step_finish",
    ]);
  });

  it("includes events from `events` collection too", () => {
    const out = translateOpenCodeResponse({
      parts: [{ type: "text", text: "hi" }],
      events: [{
        type: "session.idle",
        properties: { sessionID: "X" },
      }],
    });
    expect(out.map((e) => e.type)).toEqual([
      "text",
      "session_idle",
    ]);
  });
});

describe("hasOpenCodeMessagePayload", () => {
  it("is true when parts is present", () => {
    expect(hasOpenCodeMessagePayload({ parts: [] }))
      .toBe(true);
  });

  it("is true when an SSE collection is present", () => {
    expect(hasOpenCodeMessagePayload({ events: [] }))
      .toBe(true);
  });

  it("is true for direct permission events", () => {
    expect(hasOpenCodeMessagePayload({
      type: "permission.asked",
    } as unknown as Parameters<
      typeof hasOpenCodeMessagePayload
    >[0])).toBe(true);
  });

  it("is false for an empty record", () => {
    expect(hasOpenCodeMessagePayload({})).toBe(false);
  });
});
