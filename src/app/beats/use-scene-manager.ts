import {
  useCallback, useEffect, useRef,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { startSession } from "@/lib/terminal-api";
import { useAppStore } from "@/stores/app-store";
import {
  useTerminalStore, type QueuedBeat,
} from "@/stores/terminal-store";
import type { ActiveTerminal } from "@/stores/terminal-store";
import { fetchSettings } from "@/lib/settings-api";
import { toast } from "sonner";
import type { Beat } from "@/lib/types";
import { extractRepoPath } from "./use-ship-beat";

const DEFAULT_MAX_SESSIONS = 5;

export function useSceneManager(
  beats: Beat[],
  terminals: ActiveTerminal[],
  handleShipBeat: (beat: Beat) => Promise<void>,
) {
  const { activeRepo } = useAppStore();
  const {
    upsertTerminal, sceneQueue,
    enqueueSceneBeats, dequeueSceneBeats,
  } = useTerminalStore();

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
  });
  const maxSessions =
    settingsData?.ok && settingsData.data
      ? settingsData.data.maxConcurrentSessions
        ?? DEFAULT_MAX_SESSIONS
      : DEFAULT_MAX_SESSIONS;

  const launchQueued = useCallback(
    async (item: QueuedBeat) => {
      const repoArg =
        item.repoPath ?? activeRepo ?? undefined;
      const result = await startSession(
        item.beatId, repoArg,
      );
      if (!result.ok || !result.data) {
        toast.error(
          result.error
          ?? `Failed to start session for ${
            item.beatId
          }`,
        );
        return;
      }
      upsertTerminal({
        sessionId: result.data.id,
        beatId: item.beatId,
        beatTitle: item.beatTitle,
        repoPath:
          result.data.repoPath
          ?? item.repoPath
          ?? activeRepo ?? undefined,
        agentName: result.data.agentName,
        agentModel: result.data.agentModel,
        agentVersion: result.data.agentVersion,
        agentCommand: result.data.agentCommand,
        status: "running",
        startedAt: result.data.startedAt,
      });
    },
    [activeRepo, upsertTerminal],
  );

  const handleSceneBeats = useCallback(
    async (ids: string[]) => {
      const selected = beats.filter(
        (b) => ids.includes(b.id),
      );
      if (selected.length === 0) return;
      const running = terminals.filter(
        (t) => t.status === "running",
      ).length;
      const slots = Math.max(
        0, maxSessions - running,
      );
      for (const beat of selected.slice(0, slots)) {
        await handleShipBeat(beat);
      }
      const toQueue = selected.slice(slots);
      if (toQueue.length > 0) {
        enqueueQueued(toQueue, enqueueSceneBeats);
      }
    },
    [
      beats, terminals, maxSessions,
      handleShipBeat, enqueueSceneBeats,
    ],
  );

  useSceneQueueDrain(
    sceneQueue, terminals, maxSessions,
    dequeueSceneBeats, launchQueued,
  );

  return { handleSceneBeats };
}

function useSceneQueueDrain(
  sceneQueue: QueuedBeat[],
  terminals: ActiveTerminal[],
  maxSessions: number,
  dequeueSceneBeats: (n: number) => QueuedBeat[],
  launchQueued: (item: QueuedBeat) => Promise<void>,
) {
  const drainingRef = useRef(false);
  useEffect(() => {
    if (
      sceneQueue.length === 0
      || drainingRef.current
    ) return;
    const running = terminals.filter(
      (t) => t.status === "running",
    ).length;
    if (running >= maxSessions) return;
    const batch = dequeueSceneBeats(
      maxSessions - running,
    );
    if (batch.length === 0) return;
    drainingRef.current = true;
    void (async () => {
      for (const item of batch) {
        await launchQueued(item);
      }
      drainingRef.current = false;
    })();
  }, [
    sceneQueue, terminals, maxSessions,
    dequeueSceneBeats, launchQueued,
  ]);
}

function enqueueQueued(
  toQueue: Beat[],
  enqueueSceneBeats: (q: QueuedBeat[]) => void,
) {
  const queued: QueuedBeat[] = toQueue.map(
    (beat) => ({
      beatId: beat.id,
      beatTitle: beat.title,
      repoPath: extractRepoPath(beat),
    }),
  );
  enqueueSceneBeats(queued);
  const n = toQueue.length;
  const s = n > 1 ? "s" : "";
  toast.info(
    `${n} beat${s} queued`
    + " (waiting for available slots)",
  );
}
