/**
 * Hermetic tests for the OpenCode normalizer in
 * agent-adapter-normalizers. Covers the rich event
 * types added for tool calls, tool results, reasoning,
 * and session-error.
 */
import { describe, it, expect } from "vitest";
import {
  createOpenCodeNormalizer,
} from "@/lib/agent-adapter-normalizers";

describe("createOpenCodeNormalizer text", () => {
  it("emits assistant text and accumulates result", () => {
    const norm = createOpenCodeNormalizer();
    const a = norm({
      type: "text",
      part: { text: "hello" },
    });
    expect(a).toEqual({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    const b = norm({
      type: "text",
      part: { text: "world" },
    });
    expect(b).toMatchObject({ type: "assistant" });
    const finish = norm({
      type: "step_finish",
      part: { reason: "stop" },
    });
    expect(finish).toEqual({
      type: "result",
      result: "hello\nworld",
      is_error: false,
    });
  });

  it("step_finish reason=error flags result as error", () => {
    const norm = createOpenCodeNormalizer();
    const out = norm({
      type: "step_finish",
      part: { reason: "error" },
    });
    expect(out).toMatchObject({
      type: "result",
      is_error: true,
    });
  });

  it("step_start is dropped", () => {
    const norm = createOpenCodeNormalizer();
    expect(norm({ type: "step_start" })).toBeNull();
  });

  it("non-object input is dropped", () => {
    const norm = createOpenCodeNormalizer();
    expect(norm("not an object")).toBeNull();
    expect(norm(null)).toBeNull();
  });
});

describe("createOpenCodeNormalizer tools", () => {
  it("emits tool_use as Claude-shape assistant block", () => {
    const norm = createOpenCodeNormalizer();
    const out = norm({
      type: "tool_use",
      id: "call_1",
      name: "Bash",
      input: { command: "ls" },
    });
    expect(out).toEqual({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "call_1",
          name: "Bash",
          input: { command: "ls" },
        }],
      },
    });
  });

  it("emits tool_result as Claude-shape user block", () => {
    const norm = createOpenCodeNormalizer();
    const out = norm({
      type: "tool_result",
      tool_use_id: "call_1",
      content: "stdout output",
    });
    expect(out).toEqual({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "call_1",
          content: "stdout output",
        }],
      },
    });
  });

  it("stringifies non-string tool_result content", () => {
    const norm = createOpenCodeNormalizer();
    const out = norm({
      type: "tool_result",
      tool_use_id: "x",
      content: { exit: 0, stdout: "hi" },
    }) as Record<string, unknown>;
    const message = out.message as Record<string, unknown>;
    const content = message.content as
      Array<Record<string, unknown>>;
    expect(typeof content[0].content).toBe("string");
    expect(content[0].content).toContain("\"stdout\"");
  });
});

describe("createOpenCodeNormalizer reasoning + errors", () => {
  it("emits reasoning as a stream_event delta", () => {
    const norm = createOpenCodeNormalizer();
    const out = norm({ type: "reasoning", text: "think" });
    expect(out).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "think" },
      },
    });
  });

  it("drops empty reasoning", () => {
    const norm = createOpenCodeNormalizer();
    expect(norm({ type: "reasoning", text: "" })).toBeNull();
  });

  it("turns session_error into is_error result", () => {
    const norm = createOpenCodeNormalizer();
    const out = norm({
      type: "session_error",
      message: "boom",
    });
    expect(out).toEqual({
      type: "result",
      result: "boom",
      is_error: true,
    });
  });
});
