/**
 * Diagnostics extracted from a SessionRuntimeState at
 * child-close time. Captured BEFORE runtime.dispose()
 * so none of the fields are clobbered.
 *
 * Used by terminal-manager close handlers to build
 * enriched console logs and lifecycle payloads so a
 * SIGTERM'd child is distinguishable from a clean exit.
 */
import type {
  SessionRuntimeState,
} from "@/lib/agent-session-runtime";

export interface ChildCloseDiagnostics {
  /** "normal" when no explicit exit reason was set. */
  exitReason: string;
  /** Milliseconds between last stdout chunk and now. */
  msSinceLastStdout: number | null;
  /** `type` field of last normalized event, or null. */
  lastEventType: string | null;
  /**
   * Set when the transport adapter signaled a failed
   * turn (e.g. Codex `usageLimitExceeded`). Lets close
   * handlers detect "agent exited 0 but its turn errored"
   * — a clean OS exit that masks an unrecoverable agent
   * failure.
   */
  turnError: { eventType?: string } | null;
}

function extractLastEventType(
  state: SessionRuntimeState | null | undefined,
): string | null {
  const evt = state?.lastNormalizedEvent;
  if (!evt || typeof evt !== "object") return null;
  if (!("type" in evt)) return null;
  const t = (evt as { type: unknown }).type;
  return typeof t === "string" ? t : null;
}

export function captureChildCloseDiagnostics(
  state: SessionRuntimeState | null | undefined,
  now: number = Date.now(),
): ChildCloseDiagnostics {
  const lastStdoutAt = state?.lastStdoutAt ?? null;
  const msSinceLastStdout =
    lastStdoutAt !== null ? now - lastStdoutAt : null;
  const exitReason = state?.exitReason ?? "normal";
  return {
    exitReason,
    msSinceLastStdout,
    lastEventType: extractLastEventType(state),
    turnError: state?.lastTurnError ?? null,
  };
}

export function formatDiagnosticsForLog(
  diag: ChildCloseDiagnostics,
  signal: NodeJS.Signals | string | null | undefined,
): string {
  const signalStr = signal ?? "null";
  const msStr = diag.msSinceLastStdout === null
    ? "null"
    : String(diag.msSinceLastStdout);
  const evtStr = diag.lastEventType ?? "null";
  const turnErrStr = diag.turnError
    ? diag.turnError.eventType ?? "true"
    : "null";
  return (
    ` signal=${signalStr}` +
    ` exitReason=${diag.exitReason}` +
    ` msSinceLastStdout=${msStr}` +
    ` lastEventType=${evtStr}` +
    ` turnError=${turnErrStr}`
  );
}
