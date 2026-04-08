import { describe, expect, it } from "vitest";
import { toActiveAgentInfo } from "../page";

describe("toActiveAgentInfo", () => {
  it("strips the agent name prefix from the model column for Claude", () => {
    expect(
      toActiveAgentInfo({
        agentCommand: "claude",
        agentName: "Claude",
        model: "claude-opus-4-6",
      }),
    ).toMatchObject({
      agentName: "Claude",
      model: "Opus",
      version: "4.6",
    });
  });

  it("keeps model families that do not duplicate the agent name", () => {
    expect(
      toActiveAgentInfo({
        agentCommand: "codex",
        agentName: "Codex",
        model: "gpt-5-codex",
      }),
    ).toMatchObject({
      agentName: "Codex",
      model: "GPT Codex",
      version: "5",
    });
  });

  it("normalizes codex-cli agent name to Codex", () => {
    expect(
      toActiveAgentInfo({
        agentCommand: "codex-cli",
        agentName: "codex-cli",
        model: "gpt-5.4",
      }),
    ).toMatchObject({
      agentName: "Codex",
      model: "GPT",
      version: "5.4",
    });
  });

  it("normalizes codex-cli agent name with codex flavor", () => {
    expect(
      toActiveAgentInfo({
        agentCommand: "codex-cli",
        agentName: "codex-cli",
        model: "gpt-5.4-codex",
      }),
    ).toMatchObject({
      agentName: "Codex",
      model: "GPT Codex",
      version: "5.4",
    });
  });

  it("preserves a fully qualified agent label over the command family", () => {
    expect(
      toActiveAgentInfo({
        agentCommand: "codex",
        agentName: "GPT Codex Spark 5.3",
        model: "gpt-5.3-codex-spark",
      }),
    ).toMatchObject({
      agentName: "GPT Codex Spark 5.3",
      model: "GPT Codex Spark",
      version: "5.3",
    });
  });
});
