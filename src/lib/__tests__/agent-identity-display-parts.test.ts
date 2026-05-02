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

  it("Bug 4 regression: bare opencode kimi-k2.6 splits version off", () => {
    // Pre-fix this rendered "OpenCode Kimi-k2.6" (no space) in the
    // pill while formatAgentDisplayLabel rendered "OpenCode Kimi-k 2.6"
    // — two display formatters, two outputs for one input. Bug 4 of
    // the agent-identity audit. Both paths now go through
    // parseOpenCodePath so they agree.
    const result = parseAgentDisplayParts({
      command: "opencode",
      model: "kimi-k2.6",
    });
    expect(result.label).toBe("OpenCode Kimi-k 2.6");
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
    // Copilot is the runtime engine even when the underlying weights
    // come from Anthropic; the user needs "Copilot" in the label, not
    // just "Claude". The inner family becomes the model + flavor.
    expect(result.label).toBe("Copilot Claude Sonnet 4.5");
  });

  it("keeps provider-specific label for copilot gpt codex model", () => {
    const result = parseAgentDisplayParts({
      command: "copilot",
      model: "gpt-5.3-codex",
    });
    expect(result.pills).toEqual(["copilot", "cli"]);
    // Provider stays "Copilot"; the inner GPT-Codex family is
    // surfaced via model="GPT" and flavor="Codex" so the full
    // provenance shows: "Copilot GPT Codex 5.3".
    expect(result.label).toBe("Copilot GPT Codex 5.3");
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
