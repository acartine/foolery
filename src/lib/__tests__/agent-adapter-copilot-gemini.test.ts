import { describe, expect, it } from "vitest";
import {
  createLineNormalizer,
} from "@/lib/agent-adapter";

describe("createLineNormalizer copilot: streaming and tools", () => {
  it("normalizes assistant.message_delta to a stream event", () => {
    const normalize = createLineNormalizer("copilot");
    const result = normalize({
      type: "assistant.message_delta",
      data: {
        messageId: "msg-1",
        deltaContent: "Hello",
      },
    });
    expect(result).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    });
  });

  it("normalizes assistant.message tool requests without duplicate text", () => {
    const normalize = createLineNormalizer("copilot");
    normalize({
      type: "assistant.message_delta",
      data: {
        messageId: "msg-1",
        deltaContent: "Hello",
      },
    });
    const result = normalize({
      type: "assistant.message",
      data: {
        messageId: "msg-1",
        content: "Hello",
        toolRequests: [{
          toolCallId: "tool-1",
          name: "Bash",
          arguments: { command: "pwd" },
        }],
      },
    });
    expect(result).toEqual({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "pwd" },
        }],
      },
    });
  });

  it("normalizes user_input.requested to AskUserQuestion tool use", () => {
    const normalize = createLineNormalizer("copilot");
    const result = normalize({
      type: "user_input.requested",
      data: {
        requestId: "req-1",
        question: "Pick one",
        choices: ["Yes", "No"],
      },
    });
    expect(result).toEqual({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "req-1",
          name: "AskUserQuestion",
          input: {
            questions: [{
              question: "Pick one",
              options: [{ label: "Yes" }, { label: "No" }],
            }],
          },
        }],
      },
    });
  });
});

describe("createLineNormalizer copilot: terminal events", () => {
  it("normalizes task completion using accumulated streamed text", () => {
    const normalize = createLineNormalizer("copilot");
    normalize({
      type: "assistant.message_delta",
      data: {
        messageId: "msg-1",
        deltaContent: "Done",
      },
    });
    const result = normalize({
      type: "session.task_complete",
      data: { success: true, summary: "Ignored summary" },
    });
    expect(result).toEqual({
      type: "result",
      result: "Done",
      is_error: false,
    });
  });

  it("normalizes session.error to an error result", () => {
    const normalize = createLineNormalizer("copilot");
    const result = normalize({
      type: "session.error",
      data: { message: "Copilot failed" },
    });
    expect(result).toEqual({
      type: "result",
      result: "Copilot failed",
      is_error: true,
    });
  });
});

describe("createLineNormalizer gemini: events", () => {
  it("skips init event", () => {
    const normalize = createLineNormalizer("gemini");
    expect(normalize({
      type: "init",
      session_id: "s1",
      model: "gemini-3",
    })).toBeNull();
  });

  it("skips user message", () => {
    const normalize = createLineNormalizer("gemini");
    expect(normalize({
      type: "message",
      role: "user",
      content: "test prompt",
    })).toBeNull();
  });

  it("normalizes assistant message", () => {
    const normalize = createLineNormalizer("gemini");
    const result = normalize({
      type: "message",
      role: "assistant",
      content: "Hello",
      delta: true,
    });
    expect(result).toEqual({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello" }],
      },
    });
  });

  it("normalizes success result with accumulated text", () => {
    const normalize = createLineNormalizer("gemini");
    normalize({
      type: "message",
      role: "assistant",
      content: "Hello world",
      delta: true,
    });
    const result = normalize({
      type: "result",
      status: "success",
      stats: { total_tokens: 100 },
    });
    expect(result).toEqual({
      type: "result",
      result: "Hello world",
      is_error: false,
    });
  });

  it("normalizes error result", () => {
    const normalize = createLineNormalizer("gemini");
    const result = normalize({
      type: "result",
      status: "error",
      stats: {},
    });
    expect(result).toEqual({
      type: "result",
      result: "Gemini error",
      is_error: true,
    });
  });

  it("accumulates text across messages", () => {
    const normalize = createLineNormalizer("gemini");
    normalize({
      type: "message",
      role: "assistant",
      content: "First",
      delta: true,
    });
    normalize({
      type: "message",
      role: "assistant",
      content: "Second",
      delta: true,
    });
    const result = normalize({
      type: "result",
      status: "success",
      stats: {},
    });
    expect(result).toEqual({
      type: "result",
      result: "First\nSecond",
      is_error: false,
    });
  });
});
