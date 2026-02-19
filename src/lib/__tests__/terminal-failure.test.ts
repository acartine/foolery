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
