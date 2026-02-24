import type { AgentMessageTypeIndex } from "@/lib/agent-message-type-index";
import type { BdResult } from "@/lib/types";

/**
 * Fetch the agent message type index from the backend.
 *
 * On first call (when no persisted index exists) the backend builds the index
 * from recent log files, so the response may take a moment.
 */
export async function fetchMessageTypeIndex(): Promise<BdResult<AgentMessageTypeIndex>> {
  try {
    const res = await fetch("/api/agent-history/message-types");
    const json = await res.json();
    if (!res.ok) {
      return { ok: false, error: json.error ?? "Failed to load message type index" };
    }
    return { ok: true, data: json.data as AgentMessageTypeIndex };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load message type index",
    };
  }
}
