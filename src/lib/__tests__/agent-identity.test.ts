import { describe, expect, it } from "vitest";
import {
  formatAgentDisplayLabel,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";

describe("agent identity formatting", () => {
  it("preserves an explicit configured label in execution metadata", () => {
    const info = toExecutionAgentInfo({
      command: "codex",
      label: "GPT Codex Spark 5.3",
      model: "gpt-5.3-codex-spark",
      version: "5.3",
    });

    expect(info).toMatchObject({
      agentName: "GPT Codex Spark 5.3",
      agentProvider: "Codex",
      agentModel: "codex-spark/gpt",
      agentVersion: "5.3",
    });
  });

  it("falls back to a formatted command-derived label when no explicit label exists", () => {
    expect(
      formatAgentDisplayLabel({
        command: "codex-cli",
        model: "gpt-5.4-codex",
      }),
    ).toBe("GPT Codex 5.4");
  });
});
