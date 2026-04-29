import { describe, expect, it } from "vitest";
import {
  buildClaudeInteractiveArgs,
  buildPromptModeArgs,
  CLAUDE_APPROVAL_PROMPT_TOOL,
} from "@/lib/agent-adapter";
import {
  buildAgentArgs,
} from "@/lib/terminal-manager-initial-child-helpers";
import {
  buildSpawnArgs,
} from "@/lib/terminal-manager-take-child-helpers";
import {
  TERMINAL_DISPATCH_FAILURE_MARKER,
} from "@/lib/terminal-dispatch-capabilities";

const SKIP_PERMISSIONS = "--dangerously-skip-permissions";

describe("Claude approval launch args", () => {
  const prompt = "Do something";

  function expectClaudeApprovalBridge(args: string[]) {
    expect(args).toContain("--permission-mode");
    expect(args).toContain("default");
    expect(args).toContain("--setting-sources");
    expect(args).toContain("project");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
    expect(args).toContain("--permission-prompt-tool");
    expect(args).toContain(CLAUDE_APPROVAL_PROMPT_TOOL);
  }

  it("keeps Claude prompt-mode sessions autonomous by default", () => {
    const result = buildPromptModeArgs(
      { command: "claude" },
      prompt,
    );
    expect(result.args).toContain(SKIP_PERMISSIONS);
  });

  it("keeps Claude prompt-mode sessions autonomous in bypass mode", () => {
    const result = buildPromptModeArgs(
      { command: "claude", approvalMode: "bypass" },
      prompt,
    );
    expect(result.args).toContain(SKIP_PERMISSIONS);
  });

  it("omits Claude prompt-mode bypass when approval prompting is enabled", () => {
    const result = buildPromptModeArgs(
      { command: "claude", approvalMode: "prompt" },
      prompt,
    );
    expect(result.args.slice(0, 8)).toEqual([
      "-p",
      prompt,
      "--input-format",
      "text",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ]);
    expect(result.args).not.toContain(SKIP_PERMISSIONS);
    expectClaudeApprovalBridge(result.args);
  });

  it("keeps Claude interactive sessions autonomous by default", () => {
    const result = buildClaudeInteractiveArgs({
      command: "claude",
      model: "sonnet",
    });
    expect(result.args).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--verbose",
      "--output-format",
      "stream-json",
      SKIP_PERMISSIONS,
      "--model",
      "sonnet",
    ]);
  });

  it("omits Claude interactive bypass for approval-test agents", () => {
    const result = buildClaudeInteractiveArgs({
      command: "claude",
      model: "sonnet",
      approvalMode: "prompt",
    });
    expect(result.args.slice(0, 6)).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--verbose",
      "--output-format",
      "stream-json",
    ]);
    expect(result.args).not.toContain(SKIP_PERMISSIONS);
    expectClaudeApprovalBridge(result.args);
    expect(result.args).toContain("--model");
    expect(result.args).toContain("sonnet");
  });
});

describe("terminal Claude launch args", () => {
  const defaultAgent = {
    kind: "cli" as const,
    command: "claude",
  };
  const promptAgent = {
    kind: "cli" as const,
    command: "claude",
    approvalMode: "prompt" as const,
  };

  it("keeps bypass args for initial interactive sessions by default", () => {
    const result = buildAgentArgs(
      defaultAgent,
      "claude",
      "take",
      true,
      false,
      false,
      false,
    );
    expect(result.args).toContain(SKIP_PERMISSIONS);
  });

  it("uses non-bypass Claude args for initial interactive sessions", () => {
    const result = buildAgentArgs(
      promptAgent,
      "claude",
      "take",
      true,
      false,
      false,
      false,
    );
    expect(result.agentCmd).toBe("claude");
    expect(result.args).not.toContain(SKIP_PERMISSIONS);
    expect(result.args).toContain("--permission-prompt-tool");
  });

  it("keeps bypass args for take-loop interactive sessions by default", () => {
    const result = buildSpawnArgs(
      defaultAgent,
      "claude",
      "take",
      true,
      false,
      false,
      false,
    );
    expect(result.args).toContain(SKIP_PERMISSIONS);
  });

  it("uses non-bypass Claude args for take-loop interactive sessions", () => {
    const result = buildSpawnArgs(
      promptAgent,
      "claude",
      "take",
      true,
      false,
      false,
      false,
    );
    expect(result.cmd).toBe("claude");
    expect(result.args).not.toContain(SKIP_PERMISSIONS);
    expect(result.args).toContain("--permission-prompt-tool");
  });
});

describe("terminal take launch args forbid one-shot fallbacks", () => {
  const opencodeAgent = {
    kind: "cli" as const,
    command: "opencode",
    model: "openrouter/z-ai/glm-5.1",
  };
  const codexAgent = {
    kind: "cli" as const,
    command: "codex",
    model: "gpt-5.4",
  };

  it("uses OpenCode serve for initial take sessions", () => {
    const result = buildAgentArgs(
      opencodeAgent,
      "opencode",
      "take",
      true,
      false,
      true,
      false,
    );
    expect(result.args).toEqual([
      "serve",
      "--port",
      "0",
      "--print-logs",
    ]);
  });

  it("uses Codex app-server for initial take sessions", () => {
    const result = buildAgentArgs(
      codexAgent,
      "codex",
      "take",
      true,
      true,
      false,
      false,
    );
    expect(result.args).toEqual([
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'model="gpt-5.4"',
    ]);
  });

  it("throws instead of building initial cli-arg take args", () => {
    expect(() =>
      buildAgentArgs(
        opencodeAgent,
        "opencode",
        "take",
        false,
        false,
        false,
        false,
      )
    ).toThrow(TERMINAL_DISPATCH_FAILURE_MARKER);
  });

  it("throws instead of building follow-up cli-arg take args", () => {
    expect(() =>
      buildSpawnArgs(
        opencodeAgent,
        "opencode",
        "take",
        false,
        false,
        false,
        false,
      )
    ).toThrow(TERMINAL_DISPATCH_FAILURE_MARKER);
  });
});
