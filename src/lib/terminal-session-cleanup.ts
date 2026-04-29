/**
 * Single chokepoint for removing a terminal session from the
 * `getTerminalSessions()` map. Detaches the canonical approval registry
 * from the session before deleting so pending approvals remain visible
 * to API pollers (with `actionable=false`).
 */

import { detachSession } from "@/lib/approval-registry";
import {
  getTerminalSessions,
} from "@/lib/terminal-session-registry";

export function cleanupTerminalSessionResources(
  sessionId: string,
  reason: string,
): void {
  detachSession(sessionId, reason);
  getTerminalSessions().delete(sessionId);
}
