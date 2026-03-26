/**
 * Session lifecycle helpers (finalizeSession and its dependencies).
 * Separated to break the circular import between
 * orchestration-internals.ts and orchestration-plan-helpers.ts.
 */

import type { OrchestrationSession } from "@/lib/types";
import {
  type OrchestrationSessionEntry,
  CLEANUP_DELAY_MS,
  sessions,
  pushEvent,
} from "@/lib/orchestration-internals";
import {
  applyLineEvent,
  formatStructuredLogLine,
  extractPlanFromTaggedJson,
} from "@/lib/orchestration-plan-helpers";

function flushAssistantTail(
  entry: OrchestrationSessionEntry,
) {
  if (!entry.lineBuffer.trim()) {
    entry.lineBuffer = "";
    return;
  }

  const tail = entry.lineBuffer;
  entry.lineBuffer = "";
  applyLineEvent(entry, tail);
  pushEvent(entry, "log", formatStructuredLogLine(tail));
}

export function finalizeSession(
  entry: OrchestrationSessionEntry,
  status: OrchestrationSession["status"],
  message: string,
) {
  if (entry.exited) return;
  entry.exited = true;
  flushAssistantTail(entry);

  if (!entry.session.plan) {
    const beatTitleMap = new Map(
      Array.from(entry.allBeats.values()).map((b) => [
        b.id,
        b.title,
      ]),
    );
    const fromTags = extractPlanFromTaggedJson(
      entry.assistantText,
      beatTitleMap,
    );
    if (fromTags) {
      entry.session.plan = fromTags;
      pushEvent(entry, "plan", fromTags);
    }
  }

  entry.interactionLog.logEnd(
    status === "completed" ? 0 : 1,
    status,
  );

  entry.session.status = status;
  entry.session.completedAt = new Date().toISOString();
  if (status === "error" || status === "aborted") {
    entry.session.error = message;
    pushEvent(entry, "error", message);
  } else {
    pushEvent(entry, "status", message);
  }

  pushEvent(entry, "exit", message);

  // Free large accumulated strings.
  entry.assistantText = "";
  entry.lineBuffer = "";
  entry.draftWaves.clear();

  setTimeout(() => {
    entry.emitter.removeAllListeners();
  }, 2000);

  setTimeout(() => {
    entry.buffer.length = 0;
    entry.allBeats.clear();
    sessions.delete(entry.session.id);
  }, CLEANUP_DELAY_MS);
}
