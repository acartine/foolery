/**
 * One-line summary of a `tool_use` block's `input` payload
 * for transcript / terminal rendering.
 *
 * Tools have heterogeneous input shapes — Claude's `Bash`
 * uses `command`, OpenCode's `read` uses `filePath`,
 * MCP tools use whatever the server defines (e.g.
 * `shemcp_shell_exec` uses `cmd` + `args`). Recognized
 * shorthand keys get a clean string render; everything
 * else falls back to a compact JSON dump so unknown tools
 * still show their arguments instead of just the name.
 */

const SHORTHAND_KEYS = [
  "command",
  "description",
  "file_path",
  "filePath",
  "pattern",
  "path",
  "url",
  "query",
] as const;

export function summarizeToolInput(
  input: unknown,
  maxLen = 160,
): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length === 0) return "";

  for (const key of SHORTHAND_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return clip(value, maxLen);
    }
  }

  return clip(safeStringify(record), maxLen);
}

function clip(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function safeStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable input]";
  }
}
