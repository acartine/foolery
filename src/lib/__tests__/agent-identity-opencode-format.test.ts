import { describe, expect, it } from "vitest";
import {
  formatOpenCodeSegment,
  parseOpenCodePath,
  splitOpenCodeModelToken,
} from "@/lib/agent-identity-opencode-format";

describe("formatOpenCodeSegment", () => {
  it("uses the vocabulary table for known compound vendors", () => {
    expect(formatOpenCodeSegment("openrouter")).toBe("OpenRouter");
    expect(formatOpenCodeSegment("moonshotai")).toBe("MoonshotAI");
    expect(formatOpenCodeSegment("anthropic")).toBe("Anthropic");
    expect(formatOpenCodeSegment("z-ai")).toBe("Z-AI");
    expect(formatOpenCodeSegment("mistral")).toBe("Mistral");
    expect(formatOpenCodeSegment("google")).toBe("Google");
    expect(formatOpenCodeSegment("opencode")).toBe("OpenCode");
    expect(formatOpenCodeSegment("openai")).toBe("OpenAI");
    expect(formatOpenCodeSegment("xai")).toBe("xAI");
  });

  it("is case-insensitive on lookup", () => {
    expect(formatOpenCodeSegment("OPENROUTER")).toBe("OpenRouter");
    expect(formatOpenCodeSegment("MoonshotAI")).toBe("MoonshotAI");
  });

  it("uppercases trailing AI/ML/IO/JS suffix for unknown vendors", () => {
    expect(formatOpenCodeSegment("someothervendorai")).toBe(
      "SomeothervendorAI",
    );
    expect(formatOpenCodeSegment("foobarml")).toBe("FoobarML");
    expect(formatOpenCodeSegment("vendoraio")).toBe("VendoraIO");
    expect(formatOpenCodeSegment("vendorajs")).toBe("VendoraJS");
    // No matching suffix -> plain capitalisation.
    expect(formatOpenCodeSegment("baziojo")).toBe("Baziojo");
    expect(formatOpenCodeSegment("vendoria")).toBe("Vendoria");
  });

  it("capitalises ordinary tokens", () => {
    expect(formatOpenCodeSegment("kimi")).toBe("Kimi");
    expect(formatOpenCodeSegment("devstral")).toBe("Devstral");
  });

  it("returns empty string for empty input", () => {
    expect(formatOpenCodeSegment("")).toBe("");
  });
});

describe("splitOpenCodeModelToken", () => {
  it("splits trailing numeric run as version", () => {
    expect(splitOpenCodeModelToken("kimi-k2.6")).toEqual({
      name: "Kimi-k",
      version: "2.6",
    });
    expect(splitOpenCodeModelToken("glm-5.1")).toEqual({
      name: "Glm",
      version: "5.1",
    });
    expect(splitOpenCodeModelToken("devstral-2512")).toEqual({
      name: "Devstral",
      version: "2512",
    });
  });

  it("joins consecutive trailing numeric segments with dots", () => {
    expect(splitOpenCodeModelToken("claude-sonnet-4-5")).toEqual({
      name: "Claude Sonnet",
      version: "4.5",
    });
  });

  it("captures non-numeric tail after the version run", () => {
    expect(splitOpenCodeModelToken("gemini-2.5-pro")).toEqual({
      name: "Gemini",
      version: "2.5",
      tail: "Pro",
    });
  });

  it("returns name only when no numeric tail is present", () => {
    expect(splitOpenCodeModelToken("kimi")).toEqual({
      name: "Kimi",
    });
  });

  it("returns empty for empty input", () => {
    expect(splitOpenCodeModelToken("")).toEqual({ name: "" });
  });
});

describe("parseOpenCodePath", () => {
  it("parses canonical 3-segment path with router + vendor + model", () => {
    expect(
      parseOpenCodePath("openrouter/moonshotai/kimi-k2.6"),
    ).toEqual({
      model: "OpenRouter MoonshotAI Kimi-k",
      version: "2.6",
      router: "openrouter",
      vendor: "moonshotai",
    });
  });

  it("parses claude-sonnet-4-5 in the canonical 3-segment path", () => {
    expect(
      parseOpenCodePath("openrouter/anthropic/claude-sonnet-4-5"),
    ).toEqual({
      model: "OpenRouter Anthropic Claude Sonnet",
      version: "4.5",
      router: "openrouter",
      vendor: "anthropic",
    });
  });

  it("parses 2-segment path with no router pill", () => {
    expect(parseOpenCodePath("mistral/devstral-2512")).toEqual({
      model: "Mistral Devstral",
      version: "2512",
      vendor: "mistral",
    });
  });

  it("parses bare single-token model with version", () => {
    expect(parseOpenCodePath("kimi-k2.6")).toEqual({
      model: "Kimi-k",
      version: "2.6",
    });
  });

  it("parses bare single-token model without version", () => {
    expect(parseOpenCodePath("kimi")).toEqual({
      model: "Kimi",
    });
  });

  it("returns empty model for empty input", () => {
    expect(parseOpenCodePath("")).toEqual({ model: "" });
  });
});
