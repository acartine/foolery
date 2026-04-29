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
  it(
    "emits assistant text and emits result on session_idle",
    () => {
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
      // step_finish on a non-error reason is a per-message
      // boundary, NOT a turn boundary. It must not emit a
      // result event — that would spam turn_ended on every
      // model response.
      const finish = norm({
        type: "step_finish",
        part: { reason: "stop" },
      });
      expect(finish).toBeNull();
      // session_idle is the real turn boundary; it carries
      // the accumulated text.
      const idle = norm({ type: "session_idle" });
      expect(idle).toEqual({
        type: "result",
        result: "hello\nworld",
        is_error: false,
      });
    },
  );

  it(
    "step_finish reason=error still flags result as error",
    () => {
      // Synthesised by emitErrorResult in
      // opencode-http-session.ts when the HTTP transport
      // fails. The turn really is over, so this remains
      // the turn-end signal for transport errors.
      const norm = createOpenCodeNormalizer();
      const out = norm({
        type: "step_finish",
        part: { reason: "error" },
      });
      expect(out).toMatchObject({
        type: "result",
        is_error: true,
      });
    },
  );

  it(
    "session_idle resets accumulated text for next turn",
    () => {
      const norm = createOpenCodeNormalizer();
      norm({ type: "text", part: { text: "first" } });
      norm({ type: "session_idle" });
      norm({ type: "text", part: { text: "second" } });
      const idle = norm({ type: "session_idle" });
      expect(idle).toEqual({
        type: "result",
        result: "second",
        is_error: false,
      });
    },
  );

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
