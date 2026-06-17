import { useCallback } from "react";
import { abortSession } from "@/lib/terminal-api";
import { startBeatSession } from "@/lib/start-beat-session";
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
    setActiveSession, updateStatus,
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
      const result = await startBeatSession({
        beatId: beat.id,
        beatTitle: beat.title,
        repo: repoArg,
      });
      if (!result.ok) {
        toast.error(
          result.error
          ?? "Failed to start terminal session",
        );
        return;
      }
    },
    [
      activeRepo, hasRollingAncestor,
      setActiveSession, terminals,
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
