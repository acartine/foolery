import type { TerminalSession } from "@/lib/types";
import {
  getTerminalSessions,
} from "@/lib/terminal-session-registry";

type SessionSignal = "SIGTERM" | "SIGKILL";

type AlreadyExitedStatus =
  | "completed"
  | "error"
  | "aborted"
  | "disconnected";

export type SessionSignalOutcome =
  | { ok: true; session: TerminalSession }
  | { ok: false; reason: "not_found" }
  | {
    ok: false;
    reason: "already_exited";
    status: AlreadyExitedStatus;
  };

const EXITED_STATUSES = new Set<AlreadyExitedStatus>([
  "completed",
  "error",
  "aborted",
  "disconnected",
]);

function getAlreadyExitedStatus(
  status: TerminalSession["status"],
): AlreadyExitedStatus | null {
  if (EXITED_STATUSES.has(status as AlreadyExitedStatus)) {
    return status as AlreadyExitedStatus;
  }
  return null;
}

function sendSignal(
  pid: number,
  signal: SessionSignal,
  directKill: (signal: NodeJS.Signals | number) => boolean,
): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    console.warn(
      `[terminal-manager] Failed to signal process group ${pid} ` +
      `with ${signal}; falling back to direct child kill.`,
      error,
    );
  }

  try {
    directKill(signal);
  } catch (error) {
    console.warn(
      `[terminal-manager] Failed to signal child ${pid} ` +
      `with ${signal}.`,
      error,
    );
  }
}

export function signalSession(
  id: string,
  signal: SessionSignal,
): SessionSignalOutcome {
  const entry = getTerminalSessions().get(id);
  if (!entry) {
    return {
      ok: false,
      reason: "not_found",
    };
  }

  const {
    session,
    process: childProcess,
  } = entry;
  const alreadyExitedStatus = getAlreadyExitedStatus(
    session.status,
  );
  if (childProcess == null) {
    return {
      ok: false,
      reason: "already_exited",
      status: alreadyExitedStatus ?? "aborted",
    };
  }
  if (alreadyExitedStatus) {
    return {
      ok: false,
      reason: "already_exited",
      status: alreadyExitedStatus,
    };
  }

  session.status = "aborted";
  entry.abort?.();
  if (typeof childProcess.pid === "number") {
    sendSignal(
      childProcess.pid,
      signal,
      childProcess.kill.bind(childProcess),
    );
  } else {
    childProcess.kill(signal);
  }
  return {
    ok: true,
    session,
  };
}

export function terminateSession(
  id: string,
): SessionSignalOutcome {
  return signalSession(id, "SIGTERM");
}

export function killSession(
  id: string,
): SessionSignalOutcome {
  return signalSession(id, "SIGKILL");
}
