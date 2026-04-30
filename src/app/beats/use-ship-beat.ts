import { useCallback } from "react";
import {
  startSession, abortSession,
} from "@/lib/terminal-api";
import { useAppStore } from "@/stores/app-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type { ActiveTerminal } from "@/stores/terminal-store";
import { toast } from "sonner";
import type { Beat } from "@/lib/types";

export function useShipBeat(
  terminals: ActiveTerminal[],
  hasRollingAncestor: (
    beat: Pick<Beat, "id" | "parent">,
  ) => boolean,
) {
  const { activeRepo } = useAppStore();
  const {
    setActiveSession, upsertTerminal, updateStatus,
  } = useTerminalStore();

  const handleShipBeat = useCallback(
    async (beat: Beat) => {
      const existing = terminals.find(
        (t) =>
          t.beatId === beat.id
          && t.status === "running",
      );
      if (existing) {
        setActiveSession(existing.sessionId);
        toast.info("Opened active session");
        return;
      }
      if (hasRollingAncestor(beat)) {
        toast.info(
          "Parent beat is already rolling",
        );
        return;
      }
      const repo = extractRepoPath(beat);
      const repoArg =
        repo ?? activeRepo ?? undefined;
      const result = await startSession(
        beat.id, repoArg,
      );
      if (!result.ok || !result.data) {
        toast.error(
          result.error
          ?? "Failed to start terminal session",
        );
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beatId: beat.id,
        beatTitle: beat.title,
        repoPath:
          result.data.repoPath ?? repoArg,
        ...(result.data.knotsLeaseId
          ? { knotsLeaseId: result.data.knotsLeaseId }
          : {}),
        status: "running",
        startedAt: result.data.startedAt,
      });
    },
    [
      activeRepo, hasRollingAncestor,
      setActiveSession, terminals, upsertTerminal,
    ],
  );

  const handleAbortShipping = useCallback(
    async (beatId: string) => {
      const running = terminals.find(
        (t) =>
          t.status === "running"
          && t.beatId === beatId,
      );
      if (!running) return;
      const result = await abortSession(
        running.sessionId,
      );
      if (!result.ok) {
        toast.error(
          result.error
          ?? "Failed to terminate session",
        );
        return;
      }
      updateStatus(running.sessionId, "aborted");
      toast.success("Take terminated");
    },
    [terminals, updateStatus],
  );

  return { handleShipBeat, handleAbortShipping };
}

export function extractRepoPath(
  beat: Beat,
): string | undefined {
  return (
    beat as unknown as Record<string, unknown>
  )._repoPath as string | undefined;
}
