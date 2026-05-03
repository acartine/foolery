import { describe, it, expect } from "vitest";
import { validateCwd } from "@/lib/validate-cwd";
import { classifyTerminalFailure } from "@/lib/terminal-failure";

describe("validateCwd", () => {
  it("returns null for an existing, readable directory", async () => {
    const result = await validateCwd(process.cwd());
    expect(result).toBeNull();
  });

  it("returns a structured error message for a missing path", async () => {
    const result = await validateCwd("/tmp/definitely-does-not-exist-abc123");
    expect(result).not.toBeNull();
    expect(result).toContain("error_during_execution");
    expect(result).toContain("cwd");
    expect(result).toContain("/tmp/definitely-does-not-exist-abc123");
    expect(result).toContain("does not exist");
  });

  it("produces output that classifyTerminalFailure detects as missing_cwd", async () => {
    const errorMsg = await validateCwd("/tmp/nonexistent-worktree-path");
    expect(errorMsg).not.toBeNull();

    const failure = classifyTerminalFailure(errorMsg!, "claude");
    expect(failure).not.toBeNull();
    expect(failure?.kind).toBe("missing_cwd");
    if (!failure || failure.kind !== "missing_cwd") return;
    expect(failure.missingPath).toBe("/tmp/nonexistent-worktree-path");
  });
});
