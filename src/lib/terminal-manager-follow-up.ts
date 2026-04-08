import type {
  SessionExitReason,
} from "@/lib/agent-session-runtime";

export interface FollowUpContinuationInput {
  exitCode: number | null;
  exitReason: SessionExitReason | null;
  executionPromptSent: boolean;
  shipCompletionPromptSent: boolean;
  autoShipCompletionPrompt: string | null;
}

export function shouldContinueShipFollowUp(
  input: FollowUpContinuationInput,
): boolean {
  if (input.exitCode !== 0) return false;
  if (!input.executionPromptSent) return false;
  if (input.shipCompletionPromptSent) return false;
  if (!input.autoShipCompletionPrompt) return false;
  return !isFatalFollowUpExitReason(
    input.exitReason,
  );
}

function isFatalFollowUpExitReason(
  exitReason: SessionExitReason | null,
): boolean {
  return (
    exitReason === "timeout" ||
    exitReason === "spawn_error" ||
    exitReason === "external_abort"
  );
}
