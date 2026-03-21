export function shouldShowHistoryResponseType(
  type: string,
  thinkingDetailVisible: boolean,
): boolean {
  if (thinkingDetailVisible) return true;
  return type === "assistant";
}
