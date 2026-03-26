/**
 * Orchestration manager -- public API surface.
 *
 * Implementation is split across sibling modules to stay within the
 * 500-line file limit:
 *   - orchestration-internals.ts   (types, helpers, session store)
 *   - orchestration-session-create.ts  (create / restage)
 *   - orchestration-session-apply.ts   (apply)
 */

import type { OrchestrationSession } from "@/lib/types";

import {
  type OrchestrationSessionEntry,
  sessions,
  finalizeSession,
} from "@/lib/orchestration-internals";

// Re-export the heavy async entry points from their own modules.
export {
  createOrchestrationSession,
  createRestagedOrchestrationSession,
} from "@/lib/orchestration-session-create";

export { applyOrchestrationSession } from "@/lib/orchestration-session-apply";

// ── Lightweight session accessors ───────────────────────────────────

export function getOrchestrationSession(
  id: string
): OrchestrationSessionEntry | undefined {
  return sessions.get(id);
}

export function listOrchestrationSessions(): OrchestrationSession[] {
  return Array.from(sessions.values()).map((entry) => entry.session);
}

export function abortOrchestrationSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry || !entry.process) return false;

  entry.session.status = "aborted";
  entry.process.kill("SIGTERM");

  setTimeout(() => {
    if (entry.process && !entry.process.killed) {
      entry.process.kill("SIGKILL");
    }
  }, 5000);

  finalizeSession(entry, "aborted", "Orchestration aborted");
  return true;
}
