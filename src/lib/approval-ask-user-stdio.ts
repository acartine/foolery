import type {
  AgentSessionRuntime,
} from "@/lib/agent-session-runtime";
import type {
  ApprovalAction,
  ApprovalReplyResult,
  PendingApprovalRecord,
} from "@/lib/approval-actions";
import type {
  ApprovalResponderPayload,
} from "@/lib/approval-registry";
import type {
  SessionEntry,
} from "@/lib/terminal-manager-types";

export interface AskUserStdioInput {
  runtime: AgentSessionRuntime;
  entry: SessionEntry;
  record: PendingApprovalRecord;
  action: ApprovalAction;
  payload?: ApprovalResponderPayload;
}

export async function respondAskUserViaStdio(
  input: AskUserStdioInput,
): Promise<ApprovalReplyResult> {
  const { runtime, entry, record, action, payload } = input;
  if (action !== "respond") {
    return {
      ok: false,
      status: "unsupported",
      reason: `claude_bridge_action_unsupported:${action}`,
    };
  }
  const text = payload?.text?.trim();
  if (!text) {
    return {
      ok: false,
      reason: "claude_bridge_text_empty",
    };
  }
  const child = entry.process;
  if (!child) {
    return {
      ok: false,
      reason: "claude_bridge_child_unavailable",
    };
  }
  const formatted = formatAskUserStdioPayload(record, text);
  const sent = runtime.sendUserTurn(
    child,
    formatted,
    "approval_respond",
  );
  if (!sent) {
    return {
      ok: false,
      reason: "claude_bridge_send_user_turn_failed",
    };
  }
  return { ok: true };
}

function formatAskUserStdioPayload(
  record: PendingApprovalRecord,
  text: string,
): string {
  const lines: string[] = ["AskUserQuestion response:"];
  if (record.question) {
    lines.push(`Question: ${record.question}`);
  }
  lines.push(text);
  return lines.join("\n");
}
