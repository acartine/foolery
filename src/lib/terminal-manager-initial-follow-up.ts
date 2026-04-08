import type {
  SessionExitReason,
  SessionRuntimeConfig,
} from "@/lib/agent-session-runtime";
import type {
  InitialChildState,
} from "@/lib/terminal-manager-initial-io";
import {
  shouldContinueShipFollowUp,
} from "@/lib/terminal-manager-follow-up";

export interface InitialChildStateRef {
  current: InitialChildState;
}

export function buildContinueAfterCleanClose(
  stateRef: InitialChildStateRef,
  runtimeConfig: SessionRuntimeConfig,
  buildInitialState: (
    autoShipPrompt: string | null,
    runtimeConfig: SessionRuntimeConfig,
  ) => InitialChildState,
  pushEvent: SessionRuntimeConfig["pushEvent"],
  startTurn: (turnPrompt: string) => void,
): (exitReason: SessionExitReason | null) => Promise<boolean> {
  return async (exitReason) => {
    if (!shouldContinueShipFollowUp({
      exitCode: 0,
      exitReason,
      executionPromptSent:
        stateRef.current.executionPromptSent,
      shipCompletionPromptSent:
        stateRef.current.shipCompletionPromptSent,
      autoShipCompletionPrompt:
        stateRef.current.autoShipCompletionPrompt,
    })) {
      return false;
    }
    const followUpPrompt =
      stateRef.current.autoShipCompletionPrompt;
    if (!followUpPrompt) return false;
    stateRef.current.shipCompletionPromptSent = true;
    pushEvent({
      type: "stdout",
      data:
        "\x1b[33m-> Continuing with ship " +
        "completion follow-up prompt" +
        "\x1b[0m\n",
      timestamp: Date.now(),
    });
    stateRef.current = buildInitialState(
      null, runtimeConfig,
    );
    startTurn(followUpPrompt);
    return true;
  };
}
