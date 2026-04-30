/**
 * I/O wiring for the initial child process.
 * Delegates line buffering, event normalization,
 * AskUser auto-response, and stdin lifecycle to
 * the shared AgentSessionRuntime.
 */
import type { ChildProcess } from "node:child_process";
import type { InteractionLog } from "@/lib/interaction-logger";
import type { AgentDialect } from "@/lib/agent-adapter";
import type { createLineNormalizer } from "@/lib/agent-adapter";
import {
  createSessionRuntime,
  type AgentSessionRuntime,
  type SessionRuntimeConfig,
  type SessionExitReason,
} from "@/lib/agent-session-runtime";
import type {
  TerminalEvent,
} from "@/lib/types";
import type { CliAgentTarget } from "@/lib/types-agent-target";
import {
  type TakeLoopContext,
  enforceQueueTerminalInvariant,
  handleTakeIterationClose,
} from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
} from "@/lib/terminal-manager-take-lifecycle";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";
import type {
  PreparedTargets,
} from "@/lib/terminal-manager-session-prep";
import {
  captureChildCloseDiagnostics,
  formatDiagnosticsForLog,
  shouldTreatTurnEndedSignalAsClean,
  type ChildCloseDiagnostics,
} from "@/lib/agent-session-close-diagnostics";

// ─── InitialChildState ──────────────────────────────

export interface InitialChildState {
  runtime: AgentSessionRuntime;
  child: ChildProcess | null;
  executionPromptSent: boolean;
  shipCompletionPromptSent: boolean;
  autoShipCompletionPrompt: string | null;
}

export function createInitialChildState(
  autoShipCompletionPrompt: string | null,
  runtimeConfig: Omit<
    SessionRuntimeConfig, "onTurnEnded"
  >,
): InitialChildState {
  const state: InitialChildState = {
    runtime: null!,
    child: null,
    executionPromptSent: true,
    shipCompletionPromptSent: false,
    autoShipCompletionPrompt,
  };

  const runtime = createSessionRuntime({
    ...runtimeConfig,
    onTurnEnded: () =>
      turnEndedFollowUp(state),
  });
  state.runtime = runtime;
  return state;
}

// ─── Follow-up logic ────────────────────────────────

function turnEndedFollowUp(
  state: InitialChildState,
): boolean {
  if (
    !state.autoShipCompletionPrompt ||
    !state.executionPromptSent ||
    state.shipCompletionPromptSent
  ) {
    return false;
  }
  const child = state.child;
  if (!child) return false;
  const sent = state.runtime.sendUserTurn(
    child,
    state.autoShipCompletionPrompt,
    "ship_completion_follow_up",
  );
  if (sent) {
    state.shipCompletionPromptSent = true;
    state.runtime.config.pushEvent({
      type: "stdout",
      data: "\x1b[33m-> Auto-sent ship completion " +
        "follow-up prompt\x1b[0m\n",
      timestamp: Date.now(),
    });
    return true;
  }
  state.runtime.config.pushEvent({
    type: "stderr",
    data: "Failed to send ship completion " +
      "follow-up prompt.\n",
    timestamp: Date.now(),
  });
  return false;
}

// ─── Public API ─────────────────────────────────────

export function closeInput(
  child: ChildProcess,
  state: InitialChildState,
): void {
  state.runtime.closeInput(child);
}

export function sendUserTurn(
  child: ChildProcess,
  state: InitialChildState,
  _interactionLog: InteractionLog,
  text: string,
  source = "manual",
): boolean {
  return state.runtime.sendUserTurn(
    child, text, source,
  );
}

export function wireStdout(
  child: ChildProcess,
  _id: string,
  _beatIds: string[],
  _dialect: AgentDialect,
  _interactionLog: InteractionLog,
  _normalizeEvent: ReturnType<
    typeof createLineNormalizer
  >,
  _pushEvent: (evt: TerminalEvent) => void,
  state: InitialChildState,
): void {
  state.child = child;
  state.runtime.wireStdout(child);
}

export function wireStderr(
  child: ChildProcess,
  _id: string,
  _interactionLog: InteractionLog,
  _pushEvent: (evt: TerminalEvent) => void,
  state: InitialChildState,
): void {
  state.runtime.wireStderr(child);
}

// ─── Close / Error handlers ─────────────────────────

export function wireClose(
  child: ChildProcess,
  id: string,
  beatId: string,
  isTakeLoop: boolean,
  state: InitialChildState,
  entry: SessionEntry,
  _interactionLog: InteractionLog,
  _pushEvent: (evt: TerminalEvent) => void,
  finishSession: (code: number) => void,
  agent: CliAgentTarget,
  prepared: PreparedTargets,
  takeLoopCtx: TakeLoopContext,
  continueAfterCleanClose?: (
    exitReason: SessionExitReason | null,
  ) => Promise<boolean>,
): void {
  child.on("close", async (code, signal) => {
    state.runtime.flushLineBuffer(child);
    const diag = captureChildCloseDiagnostics(
      state.runtime.state,
    );
    logClose(
      id, beatId, isTakeLoop, code, signal,
      entry.buffer.length, diag,
    );
    const exitReason =
      state.runtime.state.exitReason;
    state.runtime.dispose();
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;
    state.child = null;
    const effectiveCode =
      shouldTreatTurnEndedSignalAsClean(code, diag)
        ? 0
        : code;

    if (isTakeLoop) {
      recordTakeLoopLifecycle(
        takeLoopCtx,
        "child_close",
        {
          claimedState:
            prepared.beat.state ?? "unknown",
          childExitCode: code,
          childSignal: signal,
          exitReason: diag.exitReason,
          msSinceLastStdout: diag.msSinceLastStdout,
          lastEventType: diag.lastEventType,
        },
      );
      handleTakeIterationClose(
        takeLoopCtx, effectiveCode, agent,
        prepared.beat.state ?? "unknown",
      ).catch((err) => {
        console.error(
          `[terminal-manager] [${id}] ` +
          `[take-loop] ` +
          `handleTakeIterationClose error:`,
          err,
        );
        finishSession(effectiveCode ?? 1);
      });
      return;
    }

    if (
      continueAfterCleanClose &&
      await continueAfterCleanClose(exitReason)
    ) {
      return;
    }

    void (async () => {
      await enforceQueueTerminalInvariant(
        takeLoopCtx,
      );
      finishSession(effectiveCode ?? 1);
    })();
  });
}

function logClose(
  id: string,
  beatId: string,
  isTakeLoop: boolean,
  code: number | null,
  signal: string | null,
  bufLen: number,
  diag: ChildCloseDiagnostics,
): void {
  const diagStr = formatDiagnosticsForLog(diag, signal);
  if (isTakeLoop) {
    console.log(
      `[terminal-manager] [${id}] [take-loop] ` +
      `initial child close: code=${code}` +
      diagStr +
      ` beat=${beatId}`,
    );
  } else {
    console.log(
      `[terminal-manager] [${id}] close: ` +
      `code=${code}` +
      diagStr +
      ` buffer=${bufLen} events`,
    );
  }
}

export function wireError(
  child: ChildProcess,
  id: string,
  isTakeLoop: boolean,
  state: InitialChildState,
  entry: SessionEntry,
  pushEvent: (evt: TerminalEvent) => void,
  finishSession: (code: number) => void,
  agent: CliAgentTarget,
  prepared: PreparedTargets,
  takeLoopCtx: TakeLoopContext,
): void {
  child.on("error", (err) => {
    console.error(
      `[terminal-manager] [${id}] spawn error:`,
      err.message,
    );
    state.runtime.dispose();
    state.child = null;
    pushEvent({
      type: "stderr",
      data: `Process error: ${err.message}\n`,
      timestamp: Date.now(),
    });
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    entry.process = null;
    if (isTakeLoop) {
      handleTakeIterationClose(
        takeLoopCtx, 1, agent,
        prepared.beat.state ?? "unknown",
      ).catch((e) => {
        console.error(
          `[terminal-manager] [${id}] ` +
          `handleTakeIterationClose error ` +
          `after spawn error:`, e,
        );
        finishSession(1);
      });
    } else {
      void enforceQueueTerminalInvariant(
        takeLoopCtx,
      ).finally(() => { finishSession(1); });
    }
  });
}
