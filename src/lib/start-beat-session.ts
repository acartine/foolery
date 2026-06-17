import { startSession } from "@/lib/terminal-api";
import type { BdResult } from "@/lib/types";
import {
  useTerminalStore,
  type ActiveTerminal,
} from "@/stores/terminal-store";

export interface StartBeatSessionInput {
  beatId: string;
  beatTitle: string;
  repo?: string;
}

export async function startBeatSession({
  beatId,
  beatTitle,
  repo,
}: StartBeatSessionInput): Promise<BdResult<ActiveTerminal>> {
  const result = await startSession(beatId, repo);
  if (!result.ok || !result.data) {
    return {
      ok: false,
      error: result.error ?? "Failed to start terminal session",
    };
  }
  const terminal: ActiveTerminal = {
    sessionId: result.data.id,
    beatId,
    beatTitle,
    repoPath: result.data.repoPath ?? repo,
    ...(result.data.knotsLeaseId
      ? { knotsLeaseId: result.data.knotsLeaseId }
      : {}),
    status: "running",
    startedAt: result.data.startedAt,
  };
  useTerminalStore.getState().upsertTerminal(terminal);
  return { ok: true, data: terminal };
}
