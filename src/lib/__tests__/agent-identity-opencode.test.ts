import { describe, expect, it } from "vitest";
import { normalizeAgentIdentity } from "@/lib/agent-identity";

/*
 * normalizeOpenCodeModel is a private helper inside agent-identity.ts.
 * The canonical contract says its outputs are observable through
 * normalizeAgentIdentity for the OpenCode branch. After foolery-b42b,
 * OpenCode emits a single canonical form: a pre-formatted display
 * string with version split off. Flavor is undefined because the
 * router segment is already part of the formatted model string.
 */

describe("normalizeAgentIdentity OpenCode canonical 3-segment paths", () => {
  it("parses openrouter/moonshotai/kimi-k2.6 to display form", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "openrouter/moonshotai/kimi-k2.6",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "OpenRouter MoonshotAI Kimi-k",
      version: "2.6",
    });
    expect(result.flavor).toBeUndefined();
  });

  it("parses openrouter/anthropic/claude-sonnet-4-5 to display form", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "openrouter/anthropic/claude-sonnet-4-5",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "OpenRouter Anthropic Claude Sonnet",
      version: "4.5",
    });
    expect(result.flavor).toBeUndefined();
  });

  it("parses openrouter/z-ai/glm-5.1 to display form", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "openrouter/z-ai/glm-5.1",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "OpenRouter Z-AI Glm",
      version: "5.1",
    });
  });

  it("parses openrouter/mistral/devstral-2512 to display form", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "openrouter/mistral/devstral-2512",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "OpenRouter Mistral Devstral",
      version: "2512",
    });
  });

  it("parses openrouter/google/gemini-2.5-pro to display form", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "openrouter/google/gemini-2.5-pro",
    });
    // Trailing non-numeric "pro" segment after the version becomes
    // a "tail" appended to the model name in display-cased form.
    expect(result).toEqual({
      provider: "OpenCode",
      model: "OpenRouter Google Gemini Pro",
      version: "2.5",
    });
  });

  it("derives version from claude-sonnet-4 path (3-segment)", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "copilot/anthropic/claude-sonnet-4",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "Copilot Anthropic Claude Sonnet",
      version: "4",
    });
  });
});

describe("normalizeAgentIdentity OpenCode shorter and edge shapes", () => {
  it("parses 2-segment vendor/model with no router pill", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "mistral/devstral-2512",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "Mistral Devstral",
      version: "2512",
    });
    expect(result.flavor).toBeUndefined();
  });

  it("parses bare single-token model with no version when no numeric tail", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "kimi",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "Kimi",
    });
    expect(result.flavor).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it("parses bare single-token model with numeric tail", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "kimi-k2.6",
    });
    expect(result).toEqual({
      provider: "OpenCode",
      model: "Kimi-k",
      version: "2.6",
    });
    expect(result.flavor).toBeUndefined();
  });

  it("returns undefined model/flavor/version for empty model", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "",
    });
    expect(result.provider).toBe("OpenCode");
    expect(result.model).toBeUndefined();
    expect(result.flavor).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it("returns undefined model/flavor/version for whitespace model", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "   ",
    });
    expect(result.provider).toBe("OpenCode");
    expect(result.model).toBeUndefined();
    expect(result.flavor).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it("handles malformed input with stray slashes", () => {
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "//openrouter//moonshotai//kimi-k2.6//",
    });
    // Empty tokens are filtered; the cleaned 3-token shape stands
    // and produces the same display-form output as canonical input.
    expect(result).toEqual({
      provider: "OpenCode",
      model: "OpenRouter MoonshotAI Kimi-k",
      version: "2.6",
    });
  });

  it("preserves provider casing as 'OpenCode' regardless of command casing", () => {
    const result = normalizeAgentIdentity({
      command: "OpenCode",
      model: "openrouter/moonshotai/kimi-k2.6",
    });
    expect(result.provider).toBe("OpenCode");
  });
});

describe("normalizeAgentIdentity OpenCode anti-leak regressions", () => {
  it("parsed path version overrides leaked binary version 4.7", () => {
    // This is the literal bug from the screenshot in foolery-2e97:
    // OpenCode running openrouter/moonshotai/kimi-k2.6 should NOT
    // surface "4.7" as the version (that's the OpenCode binary
    // version, leaked from a runtime hint somewhere upstream).
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "openrouter/moonshotai/kimi-k2.6",
      version: "4.7",
    });
    expect(result.version).toBe("2.6");
    expect(result.model).toBe("OpenRouter MoonshotAI Kimi-k");
  });

  it("falls back to caller version when bare model has no numeric tail", () => {
    // Bare 'kimi' has no numeric tail to parse. The OpenCode branch
    // falls back to agent.version as a last-resort source — this is
    // legitimate when registered config explicitly lists a version
    // for an OpenCode agent that uses a versionless model id. The
    // anti-leak guarantee operates per AC at the parser layer:
    // normalizeOpenCodeModel never reads runtime hints, only the raw
    // model string. The screenshot bug is fixed because the typical
    // OpenCode model id (openrouter/moonshotai/kimi-k2.6) DOES carry
    // a path version, and the parser-derived value wins.
    const result = normalizeAgentIdentity({
      command: "opencode",
      model: "kimi",
      version: "4.7",
    });
    expect(result.provider).toBe("OpenCode");
    expect(result.model).toBe("Kimi");
    expect(result.version).toBe("4.7");
  });
});
