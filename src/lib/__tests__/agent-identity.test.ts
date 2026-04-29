import { describe, expect, it } from "vitest";
import {
  formatAgentDisplayLabel,
  toCanonicalLeaseIdentity,
  toExecutionAgentInfo,
} from "@/lib/agent-identity";

describe("canonical lease identity", () => {
  it("does not use label as agent_name fallback", () => {
    const canonical = toCanonicalLeaseIdentity({
      command: "codex",
      label: "GPT Codex Spark 5.3",
      model: "gpt-5.3-codex-spark",
      version: "5.3",
    });

    // label is display-only; agent_name falls through
    // to displayCommandLabel("codex") → "Codex"
    expect(canonical.agent_name).toBe("Codex");
    expect(canonical.provider).toBe("Codex");
    expect(canonical.lease_model).toBe("codex-spark/gpt");
    expect(canonical.version).toBe("5.3");
    expect(canonical.agent_type).toBe("cli");
  });

  it("uses explicit agent_name when provided", () => {
    const canonical = toCanonicalLeaseIdentity({
      command: "codex",
      agent_name: "Codex CLI",
      label: "GPT Codex Spark 5.3",
      model: "gpt-5.3-codex-spark",
      version: "5.3",
    });

    expect(canonical.agent_name).toBe("Codex CLI");
  });

  it("normalizes Claude agent identity", () => {
    const info = toExecutionAgentInfo({
      command: "claude",
      model: "claude-opus-4.6",
      version: "4.6",
    });

    expect(info).toMatchObject({
      agentName: "Claude",
      agentProvider: "Claude",
      agentModel: "opus/claude",
      agentVersion: "4.6",
      agentType: "cli",
    });
  });

  it("normalizes Codex agent identity", () => {
    const info = toExecutionAgentInfo({
      command: "codex",
      model: "gpt-5.4-codex",
      version: "5.4",
    });

    expect(info).toMatchObject({
      agentName: "Codex",
      agentProvider: "Codex",
      agentModel: "codex/gpt",
      agentVersion: "5.4",
      agentType: "cli",
    });
  });

  it("normalizes OpenCode agent identity", () => {
    const info = toExecutionAgentInfo({
      command: "opencode",
      provider: "OpenCode",
      model: "copilot/anthropic/claude-sonnet-4",
      version: "4",
    });

    expect(info).toMatchObject({
      agentName: "OpenCode",
      agentProvider: "OpenCode",
      agentModel: "copilot/anthropic/claude-sonnet-4",
      agentVersion: "4",
      agentType: "cli",
    });
  });

  it("passes canonical fields through toExecutionAgentInfo", () => {
    const info = toExecutionAgentInfo({
      command: "codex",
      label: "GPT Codex Spark 5.3",
      model: "gpt-5.3-codex-spark",
      version: "5.3",
    });

    // agentName uses canonical identity, not label
    expect(info.agentName).toBe("Codex");
    expect(info.agentProvider).toBe("Codex");
    expect(info.agentModel).toBe("codex-spark/gpt");
    expect(info.agentVersion).toBe("5.3");
  });
});

describe("display label formatting", () => {
  it("still renders friendly label from raw fields", () => {
    expect(
      formatAgentDisplayLabel({
        command: "codex",
        label: "GPT Codex Spark 5.3",
        model: "gpt-5.3-codex-spark",
        version: "5.3",
      }),
    ).toBe("GPT Codex Spark 5.3");
  });

  it("falls back to formatted output when no label", () => {
    expect(
      formatAgentDisplayLabel({
        command: "codex-cli",
        model: "gpt-5.4-codex",
      }),
    ).toBe("GPT Codex 5.4");
  });

  it("uses label as last resort for display", () => {
    expect(
      formatAgentDisplayLabel({
        label: "Custom Agent Display",
      }),
    ).toBe("Custom Agent Display");
  });
});
