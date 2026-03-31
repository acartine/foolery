import { describe, expect, it, vi } from "vitest";
import {
  extractTokenUsageFromEvent,
  logTokenUsageForEvent,
} from "@/lib/agent-token-usage";

describe("agent-token-usage", () => {
  it("extracts Codex turn.completed usage", () => {
    expect(
      extractTokenUsageFromEvent("codex", {
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it("ignores incomplete Codex usage payloads", () => {
    expect(
      extractTokenUsageFromEvent("codex", {
        type: "turn.completed",
        usage: { total_tokens: 120 },
      }),
    ).toBeNull();
  });

  it("logs token_usage to the single consuming beat", () => {
    const logTokenUsage = vi.fn();
    logTokenUsageForEvent(
      {
        logTokenUsage,
      } as unknown as Parameters<
        typeof logTokenUsageForEvent
      >[0],
      "codex",
      {
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      },
      ["beat-a"],
    );

    expect(logTokenUsage).toHaveBeenCalledTimes(1);
    expect(logTokenUsage).toHaveBeenCalledWith({
      beatId: "beat-a",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("does not duplicate usage across multiple beats", () => {
    const logTokenUsage = vi.fn();
    logTokenUsageForEvent(
      {
        logTokenUsage,
      } as unknown as Parameters<
        typeof logTokenUsageForEvent
      >[0],
      "codex",
      {
        type: "turn.completed",
        usage: {
          input_tokens: 50,
          output_tokens: 25,
          total_tokens: 75,
        },
      },
      ["parent-beat"],
    );

    expect(logTokenUsage).toHaveBeenCalledTimes(1);
    expect(logTokenUsage).toHaveBeenCalledWith({
      beatId: "parent-beat",
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 75,
    });
  });
});
