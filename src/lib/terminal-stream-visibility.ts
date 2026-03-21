import type { TerminalDetailFilter } from "@/lib/terminal-detail-filter";

export type TerminalStreamKind = "stdout" | "stderr";

function colorizeStderr(chunk: string): string {
  if (!chunk) return "";
  return `\x1b[31m${chunk}\x1b[0m`;
}

export function getVisibleTerminalStreamChunk(
  detailFilter: TerminalDetailFilter,
  chunk: string,
  options: {
    stream: TerminalStreamKind;
    thinkingDetailVisible: boolean;
  },
): string {
  if (options.thinkingDetailVisible) {
    return options.stream === "stderr" ? colorizeStderr(chunk) : chunk;
  }

  if (options.stream === "stderr") {
    return "";
  }

  return detailFilter.filter(chunk);
}
