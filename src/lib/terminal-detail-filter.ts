/**
 * Stateful line filter for terminal output that strips "thinking detail"
 * when detail mode is off.
 *
 * Hides:
 * 1. Numbered file content lines (e.g. `     1→"use client";`)
 * 2. All tool output following a `▶` action header until agent prose resumes
 *
 * The filter buffers partial lines (chunks that don't end with a newline)
 * so that pattern matching works correctly across chunk boundaries.
 */

/** Strip ANSI escape sequences for pattern matching only. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Matches numbered file content lines like `     1→"use client";` */
const NUMBERED_LINE_RE = /^\s+\d+[→│]/;

/** Matches action header lines like `▶ Read /path/to/file` */
const ACTION_HEADER_RE = /^▶\s/;

/** Matches raw Codex command-execution headers like `[executing] ls -la` */
const EXECUTING_HEADER_RE = /^\[executing\]\s/;

/**
 * Heuristic: does this line look like natural-language agent prose?
 * Must start with a letter and contain a space (i.e. a phrase, not a
 * single-word path or identifier).
 */
function isAgentProse(stripped: string): boolean {
  // Agents use proper capitalization; tool output (paths, commands, code)
  // typically starts lowercase or with symbols.
  if (!/^[A-Z]/.test(stripped)) return false;
  return stripped.includes(" ");
}

export interface TerminalDetailFilter {
  /** Filter a chunk of terminal output, returning only non-detail lines. */
  filter(chunk: string): string;
  /** Reset internal line-buffering state. */
  reset(): void;
}

export function createDetailFilter(): TerminalDetailFilter {
  let pending = "";
  let inToolBlock = false;

  function filter(chunk: string): string {
    const input = pending + chunk;
    const lines = input.split("\n");

    // If input doesn't end with newline, last element is a partial line
    const hasTrailingNewline = input.endsWith("\n");
    if (!hasTrailingNewline) {
      pending = lines.pop() ?? "";
    } else {
      pending = "";
      // split produces an empty string after the trailing newline
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
    }

    const output: string[] = [];
    for (const line of lines) {
      const stripped = stripAnsi(line);
      const trimmed = stripped.trim();

      // Numbered file content — always suppress, enter tool block
      if (NUMBERED_LINE_RE.test(stripped)) {
        inToolBlock = true;
        continue;
      }

      // Action header — always show, enter tool block
      if (ACTION_HEADER_RE.test(stripped)) {
        inToolBlock = true;
        output.push(line);
        continue;
      }

      // Raw command-execution header — suppress header text but hide the
      // following tool output until agent prose resumes.
      if (EXECUTING_HEADER_RE.test(stripped)) {
        inToolBlock = true;
        continue;
      }

      if (inToolBlock) {
        // Blank line in tool block — suppress
        if (trimmed === "") continue;

        // Agent prose detected — exit tool block, show
        if (isAgentProse(trimmed)) {
          inToolBlock = false;
          output.push(line);
          continue;
        }

        // Non-prose tool output — suppress
        continue;
      }

      // Normal mode — show everything
      output.push(line);
    }

    if (output.length === 0) return "";
    return output.join("\n") + "\n";
  }

  function reset(): void {
    pending = "";
    inToolBlock = false;
  }

  return { filter, reset };
}
