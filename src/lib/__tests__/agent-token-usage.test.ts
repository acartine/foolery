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

  it("logs one token_usage entry per beat", () => {
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
      ["beat-a", "beat-b"],
    );

    expect(logTokenUsage).toHaveBeenCalledTimes(2);
    expect(logTokenUsage).toHaveBeenNthCalledWith(1, {
      beatId: "beat-a",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(logTokenUsage).toHaveBeenNthCalledWith(2, {
      beatId: "beat-b",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });
});
