import { describe, it, expect } from "vitest";
import {
  classifyTerminalFailure,
  detectAgentVendor,
} from "@/lib/terminal-failure";

describe("detectAgentVendor", () => {
  it("detects claude command strings", () => {
    expect(detectAgentVendor("claude")).toBe("claude");
    expect(detectAgentVendor("/usr/local/bin/claude -p")).toBe("claude");
  });

  it("detects codex and gemini command strings", () => {
    expect(detectAgentVendor("codex run")).toBe("codex");
    expect(detectAgentVendor("gemini-cli")).toBe("gemini");
  });

  it("falls back to unknown for unsupported commands", () => {
    expect(detectAgentVendor("my-agent")).toBe("unknown");
    expect(detectAgentVendor("")).toBe("unknown");
  });
});

describe("classifyTerminalFailure", () => {
  it("returns null for non-auth errors", () => {
    const result = classifyTerminalFailure(
      "Process exited with code 1 because lint failed",
      "claude"
    );
    expect(result).toBeNull();
  });

  it("classifies missing worktree path failures and extracts prior session id", () => {
    const text = [
      "result | The CWD issue is because the worktree directory was already removed.",
      "subtype: error_during_execution",
      "session_id: ed7f6c56-ae2f-4cbf-81a4-37d6d878bc7e",
      "errors: [\"Path \\\"/Users/cartine/foolery/.claude/worktrees/fix-shift-t-global\\\" does not exist\"]",
    ].join("\n");

    const result = classifyTerminalFailure(text, "claude");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("missing_cwd");
    if (!result || result.kind !== "missing_cwd") return;
    expect(result.missingPath).toContain(".claude/worktrees/fix-shift-t-global");
    expect(result.previousSessionId).toBe("ed7f6c56-ae2f-4cbf-81a4-37d6d878bc7e");
  });

  it("detects missing worktree path failures with ANSI codes", () => {
    const text =
      "\u001b[90merrors: [\"Path \\\"/tmp/deleted-wt\\\" does not exist\"]\u001b[0m\n\u001b[90msubtype: error_during_execution\u001b[0m";

    const result = classifyTerminalFailure(text, "claude");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("missing_cwd");
    if (!result || result.kind !== "missing_cwd") return;
    expect(result.missingPath).toBe("/tmp/deleted-wt");
    expect(result.previousSessionId).toBeNull();
  });

  it("classifies expired oauth token errors and includes guidance", () => {
    const text =
      'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}';
    const result = classifyTerminalFailure(text, "claude");
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("auth");
    expect(result?.title).toContain("authentication");
    expect(result?.steps[0]).toContain("`claude login`");
  });

  it("uses codex-specific guidance when codex is configured", () => {
    const result = classifyTerminalFailure("authentication_failed", "codex --model gpt-5");
    expect(result).not.toBeNull();
    expect(result?.steps[0]).toContain("`codex login`");
  });

  it("uses generic guidance for unknown agent commands", () => {
    const result = classifyTerminalFailure("Failed to authenticate (401)", "custom-agent run");
    expect(result).not.toBeNull();
    expect(result?.steps[0]).toContain("`custom-agent`");
  });
});
