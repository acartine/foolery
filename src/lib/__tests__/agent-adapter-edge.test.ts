import { describe, it, expect } from "vitest";
import {
  createLineNormalizer,
  buildCopilotInteractiveArgs,
} from "@/lib/agent-adapter";

describe("buildCopilotInteractiveArgs", () => {
  it("builds session args without model", () => {
    const result = buildCopilotInteractiveArgs(
      { command: "copilot" },
    );
    expect(result.command).toBe("copilot");
    expect(result.args).toEqual([
      "--session",
      "--output-format", "json",
      "--stream", "on",
      "--allow-all",
    ]);
  });

  it("builds session args with model", () => {
    const result = buildCopilotInteractiveArgs(
      { command: "copilot", model: "gpt-4o" },
    );
    expect(result.args).toContain("--model");
    expect(result.args).toContain("gpt-4o");
  });

  it("uses agent command from target", () => {
    const result = buildCopilotInteractiveArgs(
      { command: "/usr/local/bin/copilot" },
    );
    expect(result.command).toBe(
      "/usr/local/bin/copilot",
    );
  });

  it("defaults command to copilot", () => {
    const result = buildCopilotInteractiveArgs(
      { model: "gpt-4o" } as never,
    );
    expect(result.command).toBe("copilot");
  });
});

describe("createLineNormalizer — codex edge cases", () => {
  it("returns null for item.completed with unknown item type", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.completed",
      item: { id: "item_99", type: "unknown_type", text: "whatever" },
    });
    expect(result).toBeNull();
  });

  it("returns null for item.started with non-command_execution type", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.started",
      item: { id: "item_3", type: "agent_message", text: "starting" },
    });
    expect(result).toBeNull();
  });

  it("returns null for item.started with no item", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({ type: "item.started" });
    expect(result).toBeNull();
  });

  it("handles command_execution with non-string aggregated_output", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({
      type: "item.completed",
      item: {
        id: "item_4",
        type: "command_execution",
        command: "test",
        aggregated_output: null,
      },
    });
    expect(result).toEqual({
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "" }],
      },
    });
  });

  it("handles turn.failed with no error object", () => {
    const normalize = createLineNormalizer("codex");
    const result = normalize({ type: "turn.failed" });
    expect(result).toEqual({
      type: "result",
      result: "Turn failed",
      is_error: true,
    });
  });
});
