import { describe, it, expect } from "vitest";
import {
  detectAgentProviderId,
  parseAgentDisplayParts,
  providerLabel,
} from "../agent-identity";

describe("parseAgentDisplayParts", () => {
  it("adds cli pill for claude agent", () => {
    const result = parseAgentDisplayParts({
      command: "claude",
      model: "claude-sonnet-4",
    });
    expect(result.pills).toEqual(["cli"]);
    expect(result.label).toContain("Sonnet");
  });

  it("adds cli pill for codex agent", () => {
    const result = parseAgentDisplayParts({
      command: "codex",
      model: "gpt-4.1",
    });
    expect(result.pills).toEqual(["cli"]);
    expect(result.label).toBeTruthy();
  });

  it("parses opencode model with openrouter path", () => {
    const result = parseAgentDisplayParts({
      command: "opencode",
      model: "/openrouter/mistral/devstral-2512",
    });
    expect(result.label).toBe("OpenCode OpenRouter Mistral Devstral 2512");
    expect(result.pills).toEqual(["openrouter", "cli"]);
  });

  it("parses opencode model with opencode provider path", () => {
    const result = parseAgentDisplayParts({
      command: "opencode",
      model: "/opencode/anthropic/claude-sonnet-4",
    });
    expect(result.label).toBe("OpenCode OpenCode Anthropic Claude Sonnet 4");
    expect(result.pills).toEqual(["opencode", "cli"]);
  });

  it("parses opencode model with two-token path", () => {
    const result = parseAgentDisplayParts({
      command: "opencode",
      model: "mistral/devstral-2512",
    });
    expect(result.label).toBe("OpenCode Mistral Devstral 2512");
    expect(result.pills).toEqual(["cli"]);
  });

  it("handles opencode model without path", () => {
    const result = parseAgentDisplayParts({
      command: "opencode",
      model: "devstral",
    });
    expect(result.label).toBe("OpenCode Devstral");
    expect(result.pills).toEqual(["opencode", "cli"]);
  });

  it("handles opencode with no model", () => {
    const result = parseAgentDisplayParts({
      command: "opencode",
    });
    expect(result.label).toBe("OpenCode");
    expect(result.pills).toEqual(["cli"]);
  });

  it("adds cli pill for gemini agent", () => {
    const result = parseAgentDisplayParts({
      command: "gemini",
      model: "gemini-2.5-pro",
    });
    expect(result.pills).toEqual(["cli"]);
    expect(result.label).toContain("Gemini");
  });

  it("adds copilot and cli pills for copilot claude model", () => {
    const result = parseAgentDisplayParts({
      command: "copilot",
      model: "claude-sonnet-4.5",
    });
    expect(result.pills).toEqual(["copilot", "cli"]);
    // Copilot routes to inner provider Claude. The model token
    // "Claude" is dropped because it equals the provider name
    // ("drop redundant fields" rule); flavor "Sonnet" remains.
    expect(result.label).toBe("Claude Sonnet 4.5");
  });

  it("keeps provider-specific label for copilot gpt codex model", () => {
    const result = parseAgentDisplayParts({
      command: "copilot",
      model: "gpt-5.3-codex",
    });
    expect(result.pills).toEqual(["copilot", "cli"]);
    // flavor "Codex" is dropped because it equals the provider
    // ("Codex"); per the uniform "drop redundant flavor" rule.
    expect(result.label).toBe("Codex GPT 5.3");
  });

  it("detects openai commands as Codex", () => {
    expect(
      detectAgentProviderId("/usr/local/bin/openai"),
    ).toBe("codex");
    expect(
      providerLabel(
        undefined,
        "/usr/local/bin/openai",
      ),
    ).toBe("Codex");
  });
});
