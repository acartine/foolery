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
    expect(canonical.lease_model).toBe("Codex Spark/GPT");
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

  it("normalizes Claude agent identity (display-form)", () => {
    const info = toExecutionAgentInfo({
      command: "claude",
      model: "claude-opus-4.6",
      version: "4.6",
    });

    expect(info).toMatchObject({
      agentName: "Claude",
      agentProvider: "Claude",
      agentModel: "Opus/Claude",
      agentVersion: "4.6",
      agentType: "cli",
    });
  });

  it("normalizes Codex agent identity (display-form)", () => {
    const info = toExecutionAgentInfo({
      command: "codex",
      model: "gpt-5.4-codex",
      version: "5.4",
    });

    expect(info).toMatchObject({
      agentName: "Codex",
      agentProvider: "Codex",
      agentModel: "Codex/GPT",
      agentVersion: "5.4",
      agentType: "cli",
    });
  });

  it("normalizes OpenCode agent identity (display-form path)", () => {
    const info = toExecutionAgentInfo({
      command: "opencode",
      provider: "OpenCode",
      model: "copilot/anthropic/claude-sonnet-4",
      version: "4",
    });

    expect(info).toMatchObject({
      agentName: "OpenCode",
      agentProvider: "OpenCode",
      // Pre-formatted display string — single canonical form.
      agentModel: "Copilot Anthropic Claude Sonnet",
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
    expect(info.agentModel).toBe("Codex Spark/GPT");
    expect(info.agentVersion).toBe("5.3");
  });
});

describe("display label formatting", () => {
  it("renders friendly display-form label from raw fields", () => {
    expect(
      formatAgentDisplayLabel({
        command: "codex",
        label: "GPT Codex Spark 5.3",
        model: "gpt-5.3-codex-spark",
        version: "5.3",
      }),
    ).toBe("Codex GPT Codex Spark 5.3");
  });

  it("falls back to formatted output when no label", () => {
    expect(
      formatAgentDisplayLabel({
        command: "codex-cli",
        model: "gpt-5.4-codex",
      }),
    ).toBe("Codex GPT 5.4");
  });

  it("uses label as last resort for display", () => {
    expect(
      formatAgentDisplayLabel({
        label: "Custom Agent Display",
      }),
    ).toBe("Custom Agent Display");
  });
});

/* ── Regression tests for the agent-identity audit ────────────────── */

describe("Claude 1m / fast suffixes (Bug 2 regression)", () => {
  it("opus-4-7-1m: version is 4.7 (not 4.7.1) and flavor carries 1M context", () => {
    const info = toExecutionAgentInfo({
      command: "claude",
      model: "claude-opus-4-7-1m",
    });
    expect(info.agentVersion).toBe("4.7");
    expect(info.agentModel).toBe("Opus (1M context)/Claude");
  });

  it("sonnet-4-5-fast: version is 4.5 and flavor carries (Fast)", () => {
    const info = toExecutionAgentInfo({
      command: "claude",
      model: "claude-sonnet-4-5-fast",
    });
    expect(info.agentVersion).toBe("4.5");
    expect(info.agentModel).toBe("Sonnet (Fast)/Claude");
  });

  it("haiku-4-5: plain version still parses correctly", () => {
    const info = toExecutionAgentInfo({
      command: "claude",
      model: "claude-haiku-4-5",
    });
    expect(info.agentVersion).toBe("4.5");
    expect(info.agentModel).toBe("Haiku/Claude");
  });
});

describe("Copilot keeps Copilot as provider (Bug 3 regression)", () => {
  it("copilot + claude-sonnet-4-5: provider stays Copilot, inner family in model+flavor", () => {
    const info = toExecutionAgentInfo({
      command: "copilot",
      model: "claude-sonnet-4-5",
    });
    expect(info.agentProvider).toBe("Copilot");
    expect(formatAgentDisplayLabel({
      command: "copilot",
      model: "claude-sonnet-4-5",
    })).toBe("Copilot Claude Sonnet 4.5");
  });

  it("copilot + gpt-5.5: provider stays Copilot, GPT in model", () => {
    const info = toExecutionAgentInfo({
      command: "copilot",
      model: "gpt-5.5",
    });
    expect(info.agentProvider).toBe("Copilot");
    expect(formatAgentDisplayLabel({
      command: "copilot",
      model: "gpt-5.5",
    })).toBe("Copilot GPT 5.5");
  });

  it("copilot + gemini-2.5-pro: provider stays Copilot, Gemini Pro in model+flavor", () => {
    const info = toExecutionAgentInfo({
      command: "copilot",
      model: "gemini-2.5-pro",
    });
    expect(info.agentProvider).toBe("Copilot");
    expect(formatAgentDisplayLabel({
      command: "copilot",
      model: "gemini-2.5-pro",
    })).toBe("Copilot Gemini Pro 2.5");
  });
});
