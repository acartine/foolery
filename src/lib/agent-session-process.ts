/**
 * Process-group termination extracted from
 * `agent-session-runtime.ts`. Standalone to avoid
 * circular imports between the runtime core and the
 * session helpers that use it (watchdog, close input).
 */
import type { ChildProcess } from "node:child_process";

export function terminateProcessGroup(
  child: ChildProcess,
  reason: string,
  delayMs = 5000,
): void {
  const pid = child.pid;
  console.warn(
    `[terminal-manager] [terminate-process-group] ` +
    `pid=${pid ?? "unknown"} reason=${reason} ` +
    `delayMs=${delayMs}`,
  );
  try {
    if (pid) process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch { /* already dead */ }
  }
  setTimeout(() => {
    console.warn(
      `[terminate-process-group] ` +
      `pid=${pid ?? "unknown"} reason=${reason} ` +
      `signal=SIGKILL (forced after ${delayMs}ms)`,
    );
    try {
      if (pid) process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch { /* already dead */ }
    }
  }, delayMs);
}
