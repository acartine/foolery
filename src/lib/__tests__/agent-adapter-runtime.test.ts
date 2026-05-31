import { describe, expect, it } from "vitest";
import {
  buildClaudeInteractiveArgs,
  buildClaudePromptModeArgs,
  buildCodexInteractiveArgs,
  buildPromptModeArgs,
} from "@/lib/agent-adapter";
import type { CliAgentTarget } from "@/lib/types-agent-target";

const PROMPT = "Do the thing";

function codexTarget(
  runtime?: CliAgentTarget["runtime"],
): CliAgentTarget {
  return {
    kind: "cli",
    command: "codex",
    ...(runtime ? { runtime } : {}),
  };
}

function claudeTarget(
  runtime?: CliAgentTarget["runtime"],
): CliAgentTarget {
  return {
    kind: "cli",
    command: "claude",
    ...(runtime ? { runtime } : {}),
  };
}

describe("codex runtime args (interactive app-server)", () => {
  it("appends service_tier and model_reasoning_effort", () => {
    const result = buildCodexInteractiveArgs(
      codexTarget({ speed: "fast", reasoning: "high" }),
    );
    expect(result.args).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'service_tier="fast"',
      "-c",
      'model_reasoning_effort="high"',
    ]);
  });

  it("emits no runtime flags when no runtime settings present", () => {
    const result = buildCodexInteractiveArgs(codexTarget());
    expect(result.args).not.toContain("service_tier=\"fast\"");
    expect(
      result.args.some((a) => a.startsWith("model_reasoning_effort")),
    ).toBe(false);
  });

  it("passes through provider-supported xhigh reasoning", () => {
    const result = buildCodexInteractiveArgs(
      codexTarget({ speed: "default", reasoning: "xhigh" }),
    );
    expect(result.args).toContain('service_tier="default"');
    expect(result.args).toContain('model_reasoning_effort="xhigh"');
  });
});

describe("codex runtime args (one-shot exec)", () => {
  it("appends service_tier and reasoning after the model flag", () => {
    const result = buildPromptModeArgs(
      {
        command: "codex",
        model: "gpt-5.4",
        runtime: { speed: "fast", reasoning: "high" },
      },
      PROMPT,
    );
    expect(result.args).toEqual([
      "exec",
      PROMPT,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "gpt-5.4",
      "-c",
      'service_tier="fast"',
      "-c",
      'model_reasoning_effort="high"',
    ]);
  });

  it("emits no runtime flags for a bare codex target", () => {
    const result = buildPromptModeArgs({ command: "codex" }, PROMPT);
    expect(result.args).toEqual([
      "exec",
      PROMPT,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });
});

describe("claude runtime args", () => {
  it("appends --effort after permission/model args (interactive)", () => {
    const result = buildClaudeInteractiveArgs(
      claudeTarget({ reasoning: "high" }),
    );
    const effortIdx = result.args.indexOf("--effort");
    expect(effortIdx).toBeGreaterThan(-1);
    expect(result.args[effortIdx + 1]).toBe("high");
    // --effort lands after the bypass-permissions flag.
    expect(effortIdx).toBeGreaterThan(
      result.args.indexOf("--dangerously-skip-permissions"),
    );
  });

  it("appends --effort in prompt mode after the model flag", () => {
    const result = buildClaudePromptModeArgs(
      {
        command: "claude",
        model: "claude-opus-4-8",
        runtime: { reasoning: "max" },
      },
      PROMPT,
    );
    const effortIdx = result.args.indexOf("--effort");
    expect(result.args[effortIdx + 1]).toBe("max");
    expect(effortIdx).toBeGreaterThan(result.args.indexOf("--model"));
  });

  it("ignores speed for claude (no speed flag exists)", () => {
    const result = buildClaudeInteractiveArgs(
      claudeTarget({ speed: "fast", reasoning: "high" }),
    );
    expect(result.args).not.toContain("service_tier=\"fast\"");
    expect(result.args).not.toContain("--speed");
  });

  it("emits no --effort when no runtime settings present", () => {
    const result = buildClaudeInteractiveArgs(claudeTarget());
    expect(result.args).not.toContain("--effort");
  });
});
