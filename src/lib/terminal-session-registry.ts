import type { SessionEntry } from "@/lib/terminal-manager-types";

const g = globalThis as unknown as {
  __terminalSessions?: Map<string, SessionEntry>;
};

export function getTerminalSessions(): Map<string, SessionEntry> {
  if (!g.__terminalSessions) {
    g.__terminalSessions = new Map();
  }
  return g.__terminalSessions;
}
