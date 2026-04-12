export type PromptDeliveryTransport =
  | "stdio"
  | "jsonrpc"
  | "http"
  | "acp";

export interface PromptDispatchHooks {
  onDeferred?: (reason: string) => void;
  onAttempted?: () => void;
  onSucceeded?: () => void;
  onFailed?: (reason: string) => void;
}
