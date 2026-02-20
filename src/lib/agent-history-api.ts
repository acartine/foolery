import type { BdResult } from "@/lib/types";
import type { AgentHistoryPayload } from "@/lib/agent-history-types";

const BASE = "/api/agent-history";

interface FetchAgentHistoryOptions {
  repoPath?: string;
  beadId?: string;
  beadRepoPath?: string;
}

function buildQuery(options: FetchAgentHistoryOptions): string {
  const params = new URLSearchParams();
  if (options.repoPath) params.set("_repo", options.repoPath);
  if (options.beadId) params.set("beadId", options.beadId);
  if (options.beadRepoPath) params.set("beadRepo", options.beadRepoPath);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchAgentHistory(
  options: FetchAgentHistoryOptions,
): Promise<BdResult<AgentHistoryPayload>> {
  try {
    const response = await fetch(`${BASE}${buildQuery(options)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const json = (await response.json()) as {
      data?: AgentHistoryPayload;
      error?: string;
    };

    if (!response.ok) {
      return { ok: false, error: json.error ?? "Failed to load agent history" };
    }

    return { ok: true, data: json.data ?? { beats: [], sessions: [] } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agent history";
    return { ok: false, error: message };
  }
}
