/**
 * Session finish and success cleanup logic extracted
 * from terminal-manager-initial-child.ts.
 */
import { EventEmitter } from "node:events";
import type { InteractionLog } from "@/lib/interaction-logger";
import { regroomAncestors } from "@/lib/regroom";
import type {
  TerminalSession,
  TerminalEvent,
} from "@/lib/types";
import {
  updateMessageTypeIndexFromSession,
} from "@/lib/agent-message-type-index";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  toExecutionAgentInfo,
} from "@/lib/agent-identity";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import type {
  PreparedTargets,
} from "@/lib/terminal-manager-session-prep";

// ─── Constants ───────────────────────────────────────

const CLEANUP_DELAY_MS = 5 * 60 * 1000;

// ─── finishSession implementation ────────────────────

export function finishSessionImpl(
  exitCode: number,
  session: TerminalSession,
  sessionAborted: boolean,
  interactionLog: InteractionLog,
  pushEvent: (evt: TerminalEvent) => void,
  entry: SessionEntry,
  emitter: EventEmitter,
  buffer: TerminalEvent[],
  id: string,
  beatId: string,
  prepared: PreparedTargets,
  agent: CliAgentTarget,
  sessions: Map<string, SessionEntry>,
): void {
  session.exitCode = exitCode;
  session.status = sessionAborted
    ? "aborted"
    : exitCode === 0 ? "completed" : "error";
  interactionLog.logEnd(exitCode, session.status);
  pushEvent({
    type: "exit",
    data: String(exitCode),
    timestamp: Date.now(),
  });
  entry.process = null;
  entry.abort = undefined;

  if (exitCode === 0) {
    handleSuccessCleanup(
      beatId, prepared, interactionLog, agent,
    );
  }

  entry.releaseKnotsLease?.(
    sessionAborted
      ? "session_aborted"
      : exitCode === 0
        ? "session_completed"
        : "session_error",
    exitCode === 0 ? "success" : "warning",
    { exitCode, finalStatus: session.status },
  );

  setTimeout(
    () => { emitter.removeAllListeners(); }, 2000,
  );
  setTimeout(() => {
    buffer.length = 0;
    sessions.delete(id);
  }, CLEANUP_DELAY_MS);
}

export function handleSuccessCleanup(
  beatId: string,
  prepared: PreparedTargets,
  interactionLog: InteractionLog,
  agent: CliAgentTarget,
): void {
  regroomAncestors(
    beatId, prepared.resolvedRepoPath,
  ).catch((err) => {
    console.error(
      `[terminal-manager] regroom failed ` +
      `for ${beatId}:`, err,
    );
  });
  const logFile = interactionLog.filePath;
  if (logFile) {
    updateMessageTypeIndexFromSession(
      logFile,
      toExecutionAgentInfo(agent).agentName,
      agent.model,
    ).catch((err) => {
      console.error(
        `[terminal-manager] message type index ` +
        `update failed:`, err,
      );
    });
  }
}
