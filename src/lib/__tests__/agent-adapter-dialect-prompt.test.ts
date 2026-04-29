import { describe, expect, it } from "vitest";
import {
  buildPromptModeArgs,
  resolveDialect,
} from "@/lib/agent-adapter";

const PROMPT = "Do something";

describe("resolveDialect", () => {
  it("returns 'codex' for bare command 'codex'", () => {
    expect(resolveDialect("codex")).toBe("codex");
  });

  it("returns 'codex' for full path to codex binary", () => {
    expect(resolveDialect("/usr/local/bin/codex")).toBe("codex");
  });

  it("returns 'codex' for mixed-case path", () => {
    expect(resolveDialect("/opt/Codex/bin/codex")).toBe("codex");
  });

  it("returns 'codex' for bare command 'chatgpt'", () => {
    expect(resolveDialect("chatgpt")).toBe("codex");
  });

  it("returns 'codex' for full path to chatgpt binary", () => {
    expect(resolveDialect("/usr/local/bin/chatgpt")).toBe("codex");
  });

  it("returns 'copilot' for bare command 'copilot'", () => {
    expect(resolveDialect("copilot")).toBe("copilot");
  });

  it("returns 'copilot' for full path to copilot binary", () => {
    expect(resolveDialect("/usr/local/bin/copilot")).toBe("copilot");
  });

  it("returns 'claude' for bare command 'claude'", () => {
    expect(resolveDialect("claude")).toBe("claude");
  });

  it("returns 'claude' for full path to claude binary", () => {
    expect(resolveDialect("/usr/local/bin/claude")).toBe("claude");
  });

  it("returns 'claude' for unknown commands (default)", () => {
    expect(resolveDialect("my-custom-agent")).toBe("claude");
  });

  it("returns 'gemini' for bare command 'gemini'", () => {
    expect(resolveDialect("gemini")).toBe("gemini");
  });

  it("returns 'gemini' for full path to gemini binary", () => {
    expect(
      resolveDialect("/opt/homebrew/bin/gemini"),
    ).toBe("gemini");
  });
});

describe("buildPromptModeArgs: Claude and Codex", () => {
  it("builds correct claude args without model", () => {
    const result = buildPromptModeArgs({ command: "claude" }, PROMPT);
    expect(result.command).toBe("claude");
    expect(result.args).toEqual([
      "-p",
      PROMPT,
      "--input-format",
      "text",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--dangerously-skip-permissions",
    ]);
  });

  it("builds correct claude args with model", () => {
    const result = buildPromptModeArgs(
      { command: "claude", model: "sonnet" },
      PROMPT,
    );
    expect(result.args).toContain("--model");
    expect(result.args).toContain("sonnet");
    const modelIdx = result.args.indexOf("--model");
    expect(result.args[modelIdx + 1]).toBe("sonnet");
  });

  it("builds correct codex args without model", () => {
    const result = buildPromptModeArgs({ command: "codex" }, PROMPT);
    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "exec",
      PROMPT,
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("builds correct codex args with model", () => {
    const result = buildPromptModeArgs(
      { command: "codex", model: "o3" },
      PROMPT,
    );
    expect(result.args).toContain("-m");
    expect(result.args).toContain("o3");
    const mIdx = result.args.indexOf("-m");
    expect(result.args[mIdx + 1]).toBe("o3");
  });

  it("detects codex from absolute path", () => {
    const result = buildPromptModeArgs(
      { command: "/usr/local/bin/codex" },
      PROMPT,
    );
    expect(result.args[0]).toBe("exec");
  });
});

describe("buildPromptModeArgs: Copilot and Gemini", () => {
  it("builds correct copilot args without model", () => {
    const result = buildPromptModeArgs(
      { command: "copilot" },
      PROMPT,
    );
    expect(result.command).toBe("copilot");
    expect(result.args).toEqual([
      "-p",
      PROMPT,
      "--output-format",
      "json",
      "--stream",
      "on",
      "--allow-all",
      "--no-ask-user",
    ]);
  });

  it("builds correct copilot args with model", () => {
    const result = buildPromptModeArgs(
      {
        command: "copilot",
        model: "claude-sonnet-4.5",
      },
      PROMPT,
    );
    expect(result.args).toContain("--model");
    expect(result.args).toContain("claude-sonnet-4.5");
  });

  it("builds correct gemini args without model", () => {
    const result = buildPromptModeArgs(
      { command: "gemini" },
      PROMPT,
    );
    expect(result.command).toBe("gemini");
    expect(result.args).toEqual([
      "-p", PROMPT, "-o", "stream-json", "-y",
    ]);
  });

  it("builds correct gemini args with model", () => {
    const result = buildPromptModeArgs(
      { command: "gemini", model: "gemini-3-pro" },
      PROMPT,
    );
    expect(result.args).toContain("-m");
    expect(result.args).toContain("gemini-3-pro");
  });
});
