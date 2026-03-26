"use client";

import {
  classifyTerminalFailure,
  type TerminalFailureGuidance,
} from "@/lib/terminal-failure";
import { toast } from "sonner";

export type { Terminal as XtermTerminal }
  from "@xterm/xterm";
export type { FitAddon as XtermFitAddon }
  from "@xterm/addon-fit";

// Re-import for local use since re-export of types
// doesn't provide runtime references.
import type { Terminal as XtermTerminal }
  from "@xterm/xterm";

/**
 * Write the exit status message and failure hints
 * to an xterm instance. Used both for buffer replay
 * and live events.
 */
export function writeExitMessage(
  term: XtermTerminal,
  code: number,
  sessionId: string,
  recentOutputBySession: React.RefObject<
    Map<string, string>
  >,
  failureHintBySession: React.RefObject<
    Map<string, TerminalFailureGuidance>
  >,
  agentCommand: string | undefined,
  launchRecoverySession: (
    previousSessionId: string | null,
  ) => void,
): void {
  term.writeln("");
  if (code === -2) {
    term.writeln(
      "\x1b[33m\u26a0 Session disconnected"
        + " \u2014 server may have restarted\x1b[0m",
    );
    return;
  } else if (code === 0) {
    term.writeln(
      "\x1b[32m\u2713 Process completed"
        + " successfully\x1b[0m",
    );
  } else {
    writeFailureMessage(
      term,
      code,
      sessionId,
      recentOutputBySession,
      failureHintBySession,
      agentCommand,
      launchRecoverySession,
    );
  }
}

function writeFailureMessage(
  term: XtermTerminal,
  code: number,
  sessionId: string,
  recentOutputBySession: React.RefObject<
    Map<string, string>
  >,
  failureHintBySession: React.RefObject<
    Map<string, TerminalFailureGuidance>
  >,
  agentCommand: string | undefined,
  launchRecoverySession: (
    previousSessionId: string | null,
  ) => void,
): void {
  term.writeln(
    `\x1b[31m\u2717 Process exited`
      + ` with code ${code}\x1b[0m`,
  );

  const text =
    recentOutputBySession.current.get(sessionId)
    ?? "";
  const failureHint =
    failureHintBySession.current.get(sessionId)
    ?? classifyTerminalFailure(text, agentCommand);

  if (!failureHint) {
    toast.error(
      `Session failed (exit code ${code}).`
        + " Open the terminal tab for details.",
    );
    return;
  }

  failureHintBySession.current.set(
    sessionId,
    failureHint,
  );
  term.writeln(
    `\x1b[33m! ${failureHint.title}\x1b[0m`,
  );
  failureHint.steps.forEach((step, index) => {
    term.writeln(
      `\x1b[90m  ${index + 1}. ${step}\x1b[0m`,
    );
  });

  if (failureHint.kind === "missing_cwd") {
    term.writeln(
      "\x1b[33m? Use the retry action in the"
        + " toast to relaunch with recovery"
        + " context.\x1b[0m",
    );
    toast.error(failureHint.toast, {
      duration: 12_000,
      action: {
        label: "Retry Take",
        onClick: () => {
          void launchRecoverySession(
            failureHint.previousSessionId,
          );
        },
      },
    });
  } else {
    toast.error(failureHint.toast);
  }
}
