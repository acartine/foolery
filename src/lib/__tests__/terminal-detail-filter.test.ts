import { describe, expect, it } from "vitest";
import { createDetailFilter } from "@/lib/terminal-detail-filter";

describe("createDetailFilter", () => {
  it("passes through plain text lines", () => {
    const f = createDetailFilter();
    const result = f.filter("Hello world\nAnother line\n");
    expect(result).toBe("Hello world\nAnother line\n");
  });

  it("passes through action headers (▶ lines)", () => {
    const f = createDetailFilter();
    const result = f.filter(
      "▶ Read /some/file.tsx\n▶ Grep pattern\n"
    );
    expect(result).toBe("▶ Read /some/file.tsx\n▶ Grep pattern\n");
  });

  it("strips numbered file content lines", () => {
    const f = createDetailFilter();
    const input = [
      "▶ Read /some/file.tsx",
      '     1→"use client";',
      "     2→",
      "     3→import { toast } from \"sonner\";",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe("▶ Read /some/file.tsx\n");
  });

  it("shows text after numbered block ends", () => {
    const f = createDetailFilter();
    const input = [
      "▶ Read /some/file.tsx",
      '     1→"use client";',
      "     2→import { foo } from \"bar\";",
      "",
      "Now let me modify the file.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "▶ Read /some/file.tsx\nNow let me modify the file.\n\n"
    );
  });

  it("strips blank lines within a detail block", () => {
    const f = createDetailFilter();
    const input = [
      '     1→"use client";',
      "",
      "     3→import { foo } from \"bar\";",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe("");
  });

  it("handles lines with │ separator (pipe-style numbering)", () => {
    const f = createDetailFilter();
    const input = "  10│some content\n  11│more content\n";
    const result = f.filter(input);
    expect(result).toBe("");
  });

  it("handles ANSI escape codes in numbered lines", () => {
    const f = createDetailFilter();
    const input = '\x1b[90m     1→"use client";\x1b[0m\n';
    const result = f.filter(input);
    expect(result).toBe("");
  });

  it("handles chunk boundary splits", () => {
    const f = createDetailFilter();
    // First chunk: partial line (no newline)
    const r1 = f.filter("     1→\"use cli");
    expect(r1).toBe("");
    // Second chunk: completes the line
    const r2 = f.filter("ent\";\n");
    expect(r2).toBe("");
  });

  it("handles chunk boundary with non-detail continuation", () => {
    const f = createDetailFilter();
    const r1 = f.filter("Hello wor");
    expect(r1).toBe("");
    const r2 = f.filter("ld\nGoodbye\n");
    expect(r2).toBe("Hello world\nGoodbye\n");
  });

  it("reset clears internal state", () => {
    const f = createDetailFilter();
    // Enter a detail block
    f.filter('     1→"use client";\n');
    // Reset
    f.reset();
    // A blank line after reset should NOT be suppressed
    const result = f.filter("\nSome text\n");
    expect(result).toBe("\nSome text\n");
  });

  it("preserves agent text mixed with actions and detail", () => {
    const f = createDetailFilter();
    const input = [
      "Let me check the pools section.",
      "▶ Read /src/components/settings-pools-section.tsx",
      "▶ Read /src/components/settings-actions-section.tsx",
      '     1→"use client";',
      "     2→",
      '     3→import { toast } from "sonner";',
      '     4→import {',
      "     5→  Zap,",
      '     6→  Clapperboard,',
      "     7→  Layers,",
      '     8→} from "lucide-react";',
      "",
    ].join("\n") + "\n";

    const result = f.filter(input);
    expect(result).toBe(
      [
        "Let me check the pools section.",
        "▶ Read /src/components/settings-pools-section.tsx",
        "▶ Read /src/components/settings-actions-section.tsx",
        "",
      ].join("\n")
    );
  });

  it("returns empty string when all lines are detail", () => {
    const f = createDetailFilter();
    const input = '     1→line1\n     2→line2\n     3→line3\n';
    const result = f.filter(input);
    expect(result).toBe("");
  });

  // New tests for broader tool output suppression

  it("suppresses command output after ▶ Bash", () => {
    const f = createDetailFilter();
    const input = [
      "Let me list the files.",
      "▶ Bash ls -la",
      "total 42",
      "drwxr-xr-x  5 user staff  160 Mar 20 10:00 .",
      "-rw-r--r--  1 user staff 1234 Mar 20 10:00 package.json",
      "",
      "I can see the package.json file.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "Let me list the files.\n▶ Bash ls -la\nI can see the package.json file.\n\n"
    );
  });

  it("suppresses grep results after ▶ Grep", () => {
    const f = createDetailFilter();
    const input = [
      "▶ Grep thinkingDetail",
      "src/components/interaction-picker.tsx:177",
      "src/components/terminal-panel.tsx:186",
      "",
      "Found two matches across the codebase.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "▶ Grep thinkingDetail\nFound two matches across the codebase.\n\n"
    );
  });

  it("suppresses JSON output after ▶ Bash", () => {
    const f = createDetailFilter();
    const input = [
      "▶ Bash cat config.json",
      '{',
      '  "name": "foolery",',
      '  "version": "1.0.0"',
      '}',
      "",
      "The config looks correct.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "▶ Bash cat config.json\nThe config looks correct.\n\n"
    );
  });

  it("suppresses single-word file listings after ▶", () => {
    const f = createDetailFilter();
    const input = [
      "▶ Bash ls",
      "README.md",
      "package.json",
      "src",
      "",
      "Let me look at the source.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "▶ Bash ls\nLet me look at the source.\n\n"
    );
  });

  it("shows consecutive agent prose without suppression", () => {
    const f = createDetailFilter();
    const input = [
      "First I'll analyze the code.",
      "Then I'll make the changes.",
      "Finally I'll run the tests.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "First I'll analyze the code.\nThen I'll make the changes.\nFinally I'll run the tests.\n\n"
    );
  });

  it("handles multiple tool blocks interspersed with prose", () => {
    const f = createDetailFilter();
    const input = [
      "Let me read the file.",
      "▶ Read /src/app.tsx",
      '     1→import React from "react";',
      '     2→',
      "",
      "I see the issue. Let me fix it.",
      "▶ Edit /src/app.tsx",
      "old_string: foo",
      "new_string: bar",
      "",
      "Now let me verify the fix.",
      "",
    ].join("\n") + "\n";
    const result = f.filter(input);
    expect(result).toBe(
      "Let me read the file.\n▶ Read /src/app.tsx\nI see the issue. Let me fix it.\n▶ Edit /src/app.tsx\nNow let me verify the fix.\n\n"
    );
  });
});
