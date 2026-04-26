import {
  extractApprovalRequest,
} from "@/lib/approval-request-visibility";

export function shouldShowHistoryResponseType(
  type: string,
  thinkingDetailVisible: boolean,
  parsed?: unknown,
): boolean {
  if (thinkingDetailVisible) return true;
  return type === "assistant"
    || extractApprovalRequest(parsed) !== null;
}
