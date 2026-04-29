import { describe, expect, it } from "vitest";
import {
  buildClaudeInteractiveArgs,
  buildPromptModeArgs,
} from "@/lib/agent-adapter";
import {
  buildAgentArgs,
} from "@/lib/terminal-manager-initial-child-helpers";
import {
  buildSpawnArgs,
} from "@/lib/terminal-manager-take-child-helpers";

const SKIP_PERMISSIONS = "--dangerously-skip-permissions";

describe("Claude approval launch args", () => {
  const prompt = "Do something";

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
    expect(result.args).toEqual([
      "-p",
      prompt,
      "--input-format",
      "text",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ]);
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
    expect(result.args).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--verbose",
      "--output-format",
      "stream-json",
      "--model",
      "sonnet",
    ]);
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
      true,
      false,
      false,
      false,
      "prompt",
    );
    expect(result.args).toContain(SKIP_PERMISSIONS);
  });

  it("uses non-bypass Claude args for initial interactive sessions", () => {
    const result = buildAgentArgs(
      promptAgent,
      "claude",
      true,
      false,
      false,
      false,
      "prompt",
    );
    expect(result.agentCmd).toBe("claude");
    expect(result.args).not.toContain(SKIP_PERMISSIONS);
  });

  it("keeps bypass args for take-loop interactive sessions by default", () => {
    const result = buildSpawnArgs(
      defaultAgent,
      "claude",
      true,
      false,
      false,
      false,
      "prompt",
    );
    expect(result.args).toContain(SKIP_PERMISSIONS);
  });

  it("uses non-bypass Claude args for take-loop interactive sessions", () => {
    const result = buildSpawnArgs(
      promptAgent,
      "claude",
      true,
      false,
      false,
      false,
      "prompt",
    );
    expect(result.cmd).toBe("claude");
    expect(result.args).not.toContain(SKIP_PERMISSIONS);
  });
});
