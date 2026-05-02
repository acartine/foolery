import { describe, it, expect } from "vitest";
import { summarizeToolInput } from "@/lib/tool-input-summary";

describe("summarizeToolInput", () => {
  it("uses `command` for bash-style tools", () => {
    expect(summarizeToolInput({ command: "ls -la /tmp" }))
      .toBe("ls -la /tmp");
  });

  it("uses `filePath` (camelCase) for OpenCode read/edit/write", () => {
    expect(summarizeToolInput({ filePath: "/tmp/notes.md" }))
      .toBe("/tmp/notes.md");
  });

  it("uses `file_path` (snake_case) for Claude read/edit/write", () => {
    expect(summarizeToolInput({ file_path: "/tmp/notes.md" }))
      .toBe("/tmp/notes.md");
  });

  it("uses `pattern` for glob/grep", () => {
    expect(summarizeToolInput({ pattern: "**/*.ts" }))
      .toBe("**/*.ts");
  });

  it(
    "falls back to compact JSON for unknown shapes (shemcp_shell_exec)",
    () => {
      // shemcp_shell_exec uses cmd + args — neither matches the
      // recognized shorthand list, so the renderer should still
      // expose the arguments via a JSON dump rather than just
      // the tool name.
      const out = summarizeToolInput({
        cmd: "kno",
        args: ["claim", "foolery-23f3", "--json"],
      });
      expect(out).toContain("kno");
      expect(out).toContain("claim");
      expect(out).toContain("foolery-23f3");
    },
  );

  it("falls back to JSON for arbitrary MCP tool inputs", () => {
    const out = summarizeToolInput({
      element: "Increment button",
      ref: "e3",
    });
    expect(out).toContain("Increment button");
    expect(out).toContain("e3");
  });

  it("returns empty string for empty/missing input", () => {
    expect(summarizeToolInput({})).toBe("");
    expect(summarizeToolInput(null)).toBe("");
    expect(summarizeToolInput(undefined)).toBe("");
  });

  it("clips long output", () => {
    const long = "x".repeat(500);
    const out = summarizeToolInput({ command: long }, 64);
    expect(out.length).toBe(64);
    expect(out.endsWith("...")).toBe(true);
  });
});
