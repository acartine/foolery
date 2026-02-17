import { describe, it, expect } from "vitest";
import {
  resolveDialect,
  buildPromptModeArgs,
  createLineNormalizer,
} from "@/lib/agent-adapter";

describe("resolveDialect", () => {
  it("returns 'codex' for bare command 'codex'", () => {
    expect(resolveDialect("codex")).toBe("codex");
  });

  it("returns 'codex' for full path to codex binary", () => {
    expect(resolveDialect("/usr/local/bin/codex")).toBe("codex");
  });

  it("returns 'codex' for mixed-case path", () => {
    expect(resolveDialect("/opt/Codex/bin/codex")).toBe("codex");
  });

  it("returns 'claude' for bare command 'claude'", () => {
    expect(resolveDialect("claude")).toBe("claude");
  });

  it("returns 'claude' for full path to claude binary", () => {
    expect(resolveDialect("/usr/local/bin/claude")).toBe("claude");
  });

  it("returns 'claude' for unknown commands (default)", () => {
    expect(resolveDialect("my-custom-agent")).toBe("claude");
  });
});

describe("buildPromptModeArgs", () => {
  const prompt = "Do something";

  it("builds correct claude args without model", () => {
    const result = buildPromptModeArgs({ command: "claude" }, prompt);
    expect(result.command).toBe("claude");
    expect(result.args).toEqual([
      "-p",
      prompt,
      "--input-format",
      "text",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--dangerously-skip-permissions",
    ]);
  });

  it("builds correct claude args with model", () => {
    const result = buildPromptModeArgs(
      { command: "claude", model: "sonnet" },
      prompt,
    );
    expect(result.args).toContain("--model");
    expect(result.args).toContain("sonnet");
    // --model should come after --dangerously-skip-permissions
    const modelIdx = result.args.indexOf("--model");
    expect(result.args[modelIdx + 1]).toBe("sonnet");
  });

  it("builds correct codex args without model", () => {
    const result = buildPromptModeArgs({ command: "codex" }, prompt);
    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "exec",
      prompt,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("builds correct codex args with model", () => {
    const result = buildPromptModeArgs(
      { command: "codex", model: "o3" },
      prompt,
    );
    expect(result.args).toContain("-m");
    expect(result.args).toContain("o3");
    const mIdx = result.args.indexOf("-m");
    expect(result.args[mIdx + 1]).toBe("o3");
  });

  it("detects codex from absolute path", () => {
    const result = buildPromptModeArgs(
      { command: "/usr/local/bin/codex" },
      prompt,
    );
    expect(result.args[0]).toBe("exec");
  });
});

describe("createLineNormalizer — claude dialect", () => {
  const normalize = createLineNormalizer("claude");

  it("passes through valid objects", () => {
    const input = { type: "assistant", message: { content: [] } };
    expect(normalize(input)).toEqual(input);
  });

  it("returns null for non-objects", () => {
    expect(normalize(null)).toBeNull();
    expect(normalize("string")).toBeNull();
    expect(normalize(42)).toBeNull();
  });
});

describe("createLineNormalizer — codex dialect", () => {
  it("skips thread.started and turn.started", () => {
    const normalize = createLineNormalizer("codex");
    expect(normalize({ type: "thread.started", thread_id: "t1" })).toBeNull();
    expect(normalize({ type: "turn.started" })).toBeNull();
  });

  it("normalizes agent_message to assistant event", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "Hello world" },
    });
    expect(result).toEqual({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    });
  });

  it("normalizes reasoning to stream_event delta", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.completed",
      item: { id: "item_0", type: "reasoning", text: "Thinking..." },
    });
    expect(result).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Thinking..." },
      },
    });
  });

  it("normalizes command_execution item.started to stream_event", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.started",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "ls -la",
        status: "in_progress",
      },
    });
    expect(result).toEqual({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "[executing] ls -la\n" },
      },
    });
  });

  it("normalizes command_execution item.completed to user/tool_result", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.completed",
      item: {
        id: "item_2",
        type: "command_execution",
        command: "ls -la",
        aggregated_output: "file1\nfile2",
        exit_code: 0,
        status: "completed",
      },
    });
    expect(result).toEqual({
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "file1\nfile2" }],
      },
    });
  });

  it("normalizes turn.completed to result event with accumulated text", () => {
    const normalize = createLineNormalizer("codex");
    // First, send an agent_message to accumulate text
    normalize({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "Done!" },
    });
    const result = normalize({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(result).toEqual({
      type: "result",
      result: "Done!",
      is_error: false,
    });
  });

  it("normalizes turn.failed to error result", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "turn.failed",
      error: { message: "Rate limit exceeded" },
    });
    expect(result).toEqual({
      type: "result",
      result: "Rate limit exceeded",
      is_error: true,
    });
  });

  it("normalizes error event to error result", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "error",
      message: "Connection failed",
    });
    expect(result).toEqual({
      type: "result",
      result: "Connection failed",
      is_error: true,
    });
  });

  it("returns null for unknown event types", () => {
    const normalize = createLineNormalizer("codex");
    expect(normalize({ type: "something.unknown" })).toBeNull();
  });

  it("accumulates text across multiple agent_messages", () => {
    const normalize = createLineNormalizer("codex");
    normalize({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "First" },
    });
    normalize({
      type: "item.completed",
      item: { id: "item_2", type: "agent_message", text: "Second" },
    });
    const result = normalize({ type: "turn.completed", usage: {} });
    expect(result).toEqual({
      type: "result",
      result: "First\nSecond",
      is_error: false,
    });
  });
});
