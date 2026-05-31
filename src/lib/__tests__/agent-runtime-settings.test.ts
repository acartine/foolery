import { describe, expect, it } from "vitest";
import {
  CLAUDE_REASONING_EFFORTS,
  CODEX_REASONING_EFFORTS,
  agentRuntimeSettingsSchema,
  claudeRuntimeSettingsSchema,
  codexRuntimeSettingsSchema,
  foolerySettingsSchema,
} from "@/lib/schemas";
import { mergeSettingsPartial } from "@/lib/settings-update";
import { attachAgentRuntimeSettings } from "@/lib/agent-runtime-settings";
import type { CliAgentTarget } from "@/lib/types-agent-target";

const DEFAULT_RUNTIME = agentRuntimeSettingsSchema.parse(undefined);

function target(command: string): CliAgentTarget {
  return { kind: "cli", command };
}

describe("agentRuntime schema defaults", () => {
  it("defaults codex to speed=fast, reasoning=high", () => {
    expect(DEFAULT_RUNTIME.codex).toEqual({
      speed: "fast",
      reasoning: "high",
    });
  });

  it("defaults claude to reasoning=high with no speed field", () => {
    expect(DEFAULT_RUNTIME.claude).toEqual({ reasoning: "high" });
    expect("speed" in DEFAULT_RUNTIME.claude).toBe(false);
  });

  it("is present with defaults on a fully-defaulted settings object", () => {
    const settings = foolerySettingsSchema.parse({});
    expect(settings.agentRuntime).toEqual(DEFAULT_RUNTIME);
  });
});

describe("agentRuntime schema validation", () => {
  it("accepts every codex effort value in CODEX_REASONING_EFFORTS", () => {
    expect([...CODEX_REASONING_EFFORTS]).toEqual([
      "low", "medium", "high", "xhigh",
    ]);
    for (const reasoning of CODEX_REASONING_EFFORTS) {
      expect(
        codexRuntimeSettingsSchema.safeParse({ reasoning }).success,
      ).toBe(true);
    }
  });

  it("rejects codex effort=max (claude-only value)", () => {
    expect(
      codexRuntimeSettingsSchema.safeParse({ reasoning: "max" }).success,
    ).toBe(false);
  });

  it("accepts every claude effort value in CLAUDE_REASONING_EFFORTS", () => {
    expect([...CLAUDE_REASONING_EFFORTS]).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
    for (const reasoning of CLAUDE_REASONING_EFFORTS) {
      expect(
        claudeRuntimeSettingsSchema.safeParse({ reasoning }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown codex speed value", () => {
    expect(
      codexRuntimeSettingsSchema.safeParse({ speed: "turbo" }).success,
    ).toBe(false);
  });
});

describe("attachAgentRuntimeSettings", () => {
  it("attaches speed + reasoning to a codex target", () => {
    const result = attachAgentRuntimeSettings(
      target("codex"),
      DEFAULT_RUNTIME,
    );
    expect(result.runtime).toEqual({ speed: "fast", reasoning: "high" });
  });

  it("attaches only reasoning to a claude target", () => {
    const result = attachAgentRuntimeSettings(
      target("/usr/local/bin/claude"),
      DEFAULT_RUNTIME,
    );
    expect(result.runtime).toEqual({ reasoning: "high" });
  });

  it("leaves non-codex/claude dialects unchanged", () => {
    for (const command of ["copilot", "opencode", "gemini"]) {
      const result = attachAgentRuntimeSettings(
        target(command),
        DEFAULT_RUNTIME,
      );
      expect(result.runtime).toBeUndefined();
    }
  });

  it("carries through custom configured effort values", () => {
    const custom = agentRuntimeSettingsSchema.parse({
      codex: { speed: "default", reasoning: "xhigh" },
      claude: { reasoning: "max" },
    });
    expect(
      attachAgentRuntimeSettings(target("codex"), custom).runtime,
    ).toEqual({ speed: "default", reasoning: "xhigh" });
    expect(
      attachAgentRuntimeSettings(target("claude"), custom).runtime,
    ).toEqual({ reasoning: "max" });
  });
});

describe("mergeSettingsPartial agentRuntime sibling isolation", () => {
  const base = foolerySettingsSchema.parse({});

  it("patching claude.reasoning preserves codex sub-object", () => {
    const merged = mergeSettingsPartial(base, {
      agentRuntime: { claude: { reasoning: "low" } },
    });
    expect(merged.agentRuntime.claude).toEqual({ reasoning: "low" });
    expect(merged.agentRuntime.codex).toEqual({
      speed: "fast",
      reasoning: "high",
    });
  });

  it("patching codex.speed preserves claude sub-object", () => {
    const merged = mergeSettingsPartial(base, {
      agentRuntime: { codex: { speed: "default" } },
    });
    expect(merged.agentRuntime.codex).toEqual({
      speed: "default",
      reasoning: "high",
    });
    expect(merged.agentRuntime.claude).toEqual({ reasoning: "high" });
  });

  it("leaves agentRuntime untouched when partial omits it", () => {
    const merged = mergeSettingsPartial(base, { dispatchMode: "advanced" });
    expect(merged.agentRuntime).toEqual(base.agentRuntime);
  });
});
