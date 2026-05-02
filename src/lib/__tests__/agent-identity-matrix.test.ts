/**
 * Per-provider extractor + formatter matrix.
 *
 * One test per realistic input, asserting the exact `normalizeAgentIdentity`
 * output AND the exact `formatAgentDisplayLabel` output. Pure string parsing
 * and string concatenation — no I/O, no fixtures, no async. Lightning fast.
 *
 * Mirrors the cases in `scripts/audit-extractors.ts`. Adding a new agent
 * shape means adding a row in the corresponding describe block here AND in
 * the audit script.
 */
import { describe, expect, it } from "vitest";
import {
  formatAgentDisplayLabel,
  normalizeAgentIdentity,
  parseAgentDisplayParts,
} from "@/lib/agent-identity";

interface ParseCase {
  command: string;
  model: string;
  expectNormalize: {
    provider?: string;
    model?: string;
    flavor?: string;
    version?: string;
  };
  expectLabel: string;
  expectPills?: string[];
}

function check(c: ParseCase): void {
  expect(
    normalizeAgentIdentity({ command: c.command, model: c.model }),
  ).toEqual(c.expectNormalize);
  expect(
    formatAgentDisplayLabel({ command: c.command, model: c.model }),
  ).toBe(c.expectLabel);
  if (c.expectPills) {
    const parts = parseAgentDisplayParts({
      command: c.command,
      model: c.model,
    });
    expect(parts.label).toBe(c.expectLabel);
    expect(parts.pills).toEqual(c.expectPills);
  }
}

describe("Codex extractor matrix", () => {
  it("gpt-5.5 → Codex GPT 5.5", () => {
    check({
      command: "codex",
      model: "gpt-5.5",
      expectNormalize: { provider: "Codex", model: "GPT", version: "5.5" },
      expectLabel: "Codex GPT 5.5",
      expectPills: ["cli"],
    });
  });

  it("gpt-5.4 → Codex GPT 5.4", () => {
    check({
      command: "codex",
      model: "gpt-5.4",
      expectNormalize: { provider: "Codex", model: "GPT", version: "5.4" },
      expectLabel: "Codex GPT 5.4",
    });
  });

  it("gpt-5.4-mini → Codex GPT Mini 5.4", () => {
    check({
      command: "codex",
      model: "gpt-5.4-mini",
      expectNormalize: {
        provider: "Codex", model: "GPT", flavor: "Mini", version: "5.4",
      },
      expectLabel: "Codex GPT Mini 5.4",
    });
  });

  it("gpt-5.3-codex-spark → Codex GPT Codex Spark 5.3", () => {
    check({
      command: "codex",
      model: "gpt-5.3-codex-spark",
      expectNormalize: {
        provider: "Codex",
        model: "GPT",
        flavor: "Codex Spark",
        version: "5.3",
      },
      expectLabel: "Codex GPT Codex Spark 5.3",
    });
  });

  it("gpt-5.3-codex-mini → Codex GPT Codex Mini 5.3", () => {
    check({
      command: "codex",
      model: "gpt-5.3-codex-mini",
      expectNormalize: {
        provider: "Codex",
        model: "GPT",
        flavor: "Codex Mini",
        version: "5.3",
      },
      expectLabel: "Codex GPT Codex Mini 5.3",
    });
  });

  it("gpt-5-codex-max → Codex GPT Codex Max 5", () => {
    check({
      command: "codex",
      model: "gpt-5-codex-max",
      expectNormalize: {
        provider: "Codex",
        model: "GPT",
        flavor: "Codex Max",
        version: "5",
      },
      expectLabel: "Codex GPT Codex Max 5",
    });
  });

  it("chatgpt-5.5 → Codex ChatGPT 5.5", () => {
    check({
      command: "codex",
      model: "chatgpt-5.5",
      expectNormalize: {
        provider: "Codex",
        model: "ChatGPT",
        version: "5.5",
      },
      expectLabel: "Codex ChatGPT 5.5",
    });
  });
});

describe("Claude extractor matrix", () => {
  it("claude-opus-4-7 → Claude Opus 4.7", () => {
    check({
      command: "claude",
      model: "claude-opus-4-7",
      expectNormalize: {
        provider: "Claude",
        model: "Claude",
        flavor: "Opus",
        version: "4.7",
      },
      expectLabel: "Claude Opus 4.7",
    });
  });

  it("claude-sonnet-4-6 → Claude Sonnet 4.6", () => {
    check({
      command: "claude",
      model: "claude-sonnet-4-6",
      expectNormalize: {
        provider: "Claude",
        model: "Claude",
        flavor: "Sonnet",
        version: "4.6",
      },
      expectLabel: "Claude Sonnet 4.6",
    });
  });

  it("claude-haiku-4-5 → Claude Haiku 4.5", () => {
    check({
      command: "claude",
      model: "claude-haiku-4-5",
      expectNormalize: {
        provider: "Claude",
        model: "Claude",
        flavor: "Haiku",
        version: "4.5",
      },
      expectLabel: "Claude Haiku 4.5",
    });
  });

  it("claude-opus-4-7-1m → Claude Opus (1M context) 4.7 (Bug 2 regression)", () => {
    check({
      command: "claude",
      model: "claude-opus-4-7-1m",
      expectNormalize: {
        provider: "Claude",
        model: "Claude",
        flavor: "Opus (1M context)",
        version: "4.7",
      },
      expectLabel: "Claude Opus (1M context) 4.7",
    });
  });

  it("claude-sonnet-4-5-fast → Claude Sonnet (Fast) 4.5", () => {
    check({
      command: "claude",
      model: "claude-sonnet-4-5-fast",
      expectNormalize: {
        provider: "Claude",
        model: "Claude",
        flavor: "Sonnet (Fast)",
        version: "4.5",
      },
      expectLabel: "Claude Sonnet (Fast) 4.5",
    });
  });
});

describe("Gemini extractor matrix", () => {
  it("gemini-2.5-pro → Gemini Pro 2.5", () => {
    check({
      command: "gemini",
      model: "gemini-2.5-pro",
      expectNormalize: {
        provider: "Gemini",
        model: "Gemini",
        flavor: "Pro",
        version: "2.5",
      },
      expectLabel: "Gemini Pro 2.5",
    });
  });

  it("gemini-2.5-flash → Gemini Flash 2.5", () => {
    check({
      command: "gemini",
      model: "gemini-2.5-flash",
      expectNormalize: {
        provider: "Gemini",
        model: "Gemini",
        flavor: "Flash",
        version: "2.5",
      },
      expectLabel: "Gemini Flash 2.5",
    });
  });

  it("gemini-2.5-flash-lite → Gemini Flash Lite 2.5", () => {
    check({
      command: "gemini",
      model: "gemini-2.5-flash-lite",
      expectNormalize: {
        provider: "Gemini",
        model: "Gemini",
        flavor: "Flash Lite",
        version: "2.5",
      },
      expectLabel: "Gemini Flash Lite 2.5",
    });
  });

  it("gemini-3-pro-preview → Gemini Pro (Preview) 3", () => {
    check({
      command: "gemini",
      model: "gemini-3-pro-preview",
      expectNormalize: {
        provider: "Gemini",
        model: "Gemini",
        flavor: "Pro (Preview)",
        version: "3",
      },
      expectLabel: "Gemini Pro (Preview) 3",
    });
  });
});

describe("Copilot extractor matrix (Bug 3 regression)", () => {
  it("claude-sonnet-4-5 → Copilot Claude Sonnet 4.5", () => {
    check({
      command: "copilot",
      model: "claude-sonnet-4-5",
      expectNormalize: {
        provider: "Copilot",
        model: "Claude",
        flavor: "Sonnet",
        version: "4.5",
      },
      expectLabel: "Copilot Claude Sonnet 4.5",
      expectPills: ["copilot", "cli"],
    });
  });

  it("gpt-5.5 → Copilot GPT 5.5", () => {
    check({
      command: "copilot",
      model: "gpt-5.5",
      expectNormalize: {
        provider: "Copilot",
        model: "GPT",
        version: "5.5",
      },
      expectLabel: "Copilot GPT 5.5",
      expectPills: ["copilot", "cli"],
    });
  });

  it("gemini-2.5-pro → Copilot Gemini Pro 2.5", () => {
    check({
      command: "copilot",
      model: "gemini-2.5-pro",
      expectNormalize: {
        provider: "Copilot",
        model: "Gemini",
        flavor: "Pro",
        version: "2.5",
      },
      expectLabel: "Copilot Gemini Pro 2.5",
      expectPills: ["copilot", "cli"],
    });
  });

  it("gpt-5.3-codex → Copilot GPT Codex 5.3", () => {
    check({
      command: "copilot",
      model: "gpt-5.3-codex",
      expectNormalize: {
        provider: "Copilot",
        model: "GPT",
        flavor: "Codex",
        version: "5.3",
      },
      expectLabel: "Copilot GPT Codex 5.3",
      expectPills: ["copilot", "cli"],
    });
  });
});

describe("OpenCode extractor matrix: 3-segment router/vendor/model", () => {
  it("openrouter/moonshotai/kimi-k2.6 → MoonshotAI Kimi-k 2.6", () => {
    check({
      command: "opencode",
      model: "openrouter/moonshotai/kimi-k2.6",
      expectNormalize: {
        provider: "OpenCode",
        model: "OpenRouter MoonshotAI Kimi-k",
        version: "2.6",
      },
      expectLabel: "OpenCode OpenRouter MoonshotAI Kimi-k 2.6",
      expectPills: ["openrouter", "cli"],
    });
  });

  it("openrouter/anthropic/claude-sonnet-4-5 → Anthropic Claude Sonnet 4.5", () => {
    check({
      command: "opencode",
      model: "openrouter/anthropic/claude-sonnet-4-5",
      expectNormalize: {
        provider: "OpenCode",
        model: "OpenRouter Anthropic Claude Sonnet",
        version: "4.5",
      },
      expectLabel: "OpenCode OpenRouter Anthropic Claude Sonnet 4.5",
      expectPills: ["openrouter", "cli"],
    });
  });

  it("openrouter/z-ai/glm-5.1 → Z-AI GLM 5.1 (Bug 5 regression)", () => {
    check({
      command: "opencode",
      model: "openrouter/z-ai/glm-5.1",
      expectNormalize: {
        provider: "OpenCode",
        model: "OpenRouter Z-AI GLM",
        version: "5.1",
      },
      expectLabel: "OpenCode OpenRouter Z-AI GLM 5.1",
      expectPills: ["openrouter", "cli"],
    });
  });

  it("openrouter/mistralai/devstral-2512 → MistralAI Devstral 2512", () => {
    check({
      command: "opencode",
      model: "openrouter/mistralai/devstral-2512",
      expectNormalize: {
        provider: "OpenCode",
        model: "OpenRouter MistralAI Devstral",
        version: "2512",
      },
      expectLabel: "OpenCode OpenRouter MistralAI Devstral 2512",
      expectPills: ["openrouter", "cli"],
    });
  });

  it("openrouter/minimax/minimax-m2.7 → Minimax Minimax-m 2.7", () => {
    check({
      command: "opencode",
      model: "openrouter/minimax/minimax-m2.7",
      expectNormalize: {
        provider: "OpenCode",
        model: "OpenRouter Minimax Minimax-m",
        version: "2.7",
      },
      expectLabel: "OpenCode OpenRouter Minimax Minimax-m 2.7",
      expectPills: ["openrouter", "cli"],
    });
  });

  it("openrouter/google/gemini-2.5-pro → Google Gemini Pro 2.5", () => {
    check({
      command: "opencode",
      model: "openrouter/google/gemini-2.5-pro",
      expectNormalize: {
        provider: "OpenCode",
        model: "OpenRouter Google Gemini Pro",
        version: "2.5",
      },
      expectLabel: "OpenCode OpenRouter Google Gemini Pro 2.5",
      expectPills: ["openrouter", "cli"],
    });
  });

});

describe("OpenCode extractor matrix: bare and 2-segment shapes", () => {
  it("bare kimi-k2.6 → Kimi-k 2.6 (Bug 4 regression)", () => {
    check({
      command: "opencode",
      model: "kimi-k2.6",
      expectNormalize: {
        provider: "OpenCode",
        model: "Kimi-k",
        version: "2.6",
      },
      expectLabel: "OpenCode Kimi-k 2.6",
      expectPills: ["opencode", "cli"],
    });
  });

  it("2-segment vendor/model: mistral/devstral-2512 → Mistral Devstral 2512", () => {
    check({
      command: "opencode",
      model: "mistral/devstral-2512",
      expectNormalize: {
        provider: "OpenCode",
        model: "Mistral Devstral",
        version: "2512",
      },
      expectLabel: "OpenCode Mistral Devstral 2512",
      expectPills: ["cli"],
    });
  });
});
